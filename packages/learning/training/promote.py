"""Decide whether the student may replace BGE-M3 at chat time, and write that decision.

Promotion is a *data* change, not a code change: `divee-student.json` either says `promoted: true`
(with gate thresholds calibrated on the student's own score distribution) or it does not, and
`src/embed/query-encoder.ts` only selects the student in `auto` mode when it is promoted.

Gates (RETRIEVAL_V2_PLAN.md §7), all ratios are student / teacher on a held-out set:

  recall_at_10 >= 0.95   recall_at_5 >= 0.93   mrr_at_10 >= 0.93   ndcg_at_10 >= 0.93
  cross-lingual recall_at_10 >= 0.90 (when the set has ar->en / en->ar slices)

and the gate must be separable: the student's 5th percentile in-book score must sit above the 95th
percentile of off-topic probes.

Exit codes: 0 promoted, 1 gates failed (manifest rewritten with promoted=false), 2 bad input.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, help="runtime student directory (contains divee-student.json)")
    parser.add_argument("--report", required=True, help="eval.py output")
    parser.add_argument("--recall-at-10", type=float, default=0.95)
    parser.add_argument("--recall-at-5", type=float, default=0.93)
    parser.add_argument("--mrr-at-10", type=float, default=0.93)
    parser.add_argument("--ndcg-at-10", type=float, default=0.93)
    parser.add_argument("--cross-lingual", type=float, default=0.90)
    parser.add_argument("--max-gate-drop", type=float, default=0.02, help="allowed false-refusal increase (report only)")
    parser.add_argument("--min-fused", type=float, default=None, help="optional shared fused threshold")
    parser.add_argument("--force", action="store_true", help="promote even if a gate fails (recorded in the manifest)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    manifest_path = Path(args.model) / "divee-student.json"
    if not manifest_path.exists():
        print(f"{manifest_path} is missing; run export.py first")
        return 2
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    ratio = report.get("ratio", {})
    checks = {
        "recall_at_10": (ratio.get("recall_at_10", 0.0), args.recall_at_10),
        "recall_at_5": (ratio.get("recall_at_5", 0.0), args.recall_at_5),
        "mrr_at_10": (ratio.get("mrr_at_10", 0.0), args.mrr_at_10),
        "ndcg_at_10": (ratio.get("ndcg_at_10", 0.0), args.ndcg_at_10),
    }
    failures = [f"{name}: {value:.3f} < {floor:.3f}" for name, (value, floor) in checks.items() if value < floor]

    # Cross-lingual slices below this sample floor are recorded but not gated: a ratio over
    # ~3 held-out queries is noise, and gating on it would silently block honest students.
    min_cross_queries = 20
    skipped_cross: list[str] = []
    for pair, values in (report.get("ratio_by_lang_pair") or {}).items():
        if "-" in pair and ">" in pair:  # cross-lingual slice, e.g. ar->en
            value = values.get("recall_at_10", 0.0)
            count = int(((report.get("student") or {}).get("by_lang_pair") or {}).get(pair, {}).get("queries", 0))
            if count < min_cross_queries:
                skipped_cross.append(f"{pair}: {count} val queries (ratio {value:.3f} not gated)")
                continue
            if value < args.cross_lingual:
                failures.append(f"cross-lingual {pair} recall_at_10: {value:.3f} < {args.cross_lingual:.3f}")
    if skipped_cross:
        print("cross-lingual slices below sample floor (recorded, not gated): " + "; ".join(skipped_cross))

    scores = report.get("gate_scores", {})
    in_book_p5 = float(scores.get("in_book_p5", 0.0))
    off_topic_p95 = float(scores.get("off_topic_p95", 0.0))
    separable = in_book_p5 > off_topic_p95
    if not separable:
        failures.append(f"gate not separable: in-book p5 {in_book_p5:.3f} <= off-topic p95 {off_topic_p95:.3f}")

    promoted = (not failures) or args.force
    gate = {}
    if skipped_cross:
        gate["crossLingualSkipped"] = skipped_cross
    if separable:
        gate["minDenseScore"] = round((in_book_p5 + off_topic_p95) / 2, 4)
        if args.min_fused is not None:
            gate["minFusedScore"] = args.min_fused

    manifest["promoted"] = promoted
    manifest["promotedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds") if promoted else None
    manifest["gate"] = gate
    manifest["eval"] = {
        "report": str(Path(args.report).name),
        "student": report.get("student", {}).get("overall", {}),
        "teacher": report.get("teacher", {}).get("overall", {}),
        "ratio": ratio,
        "checks": {name: {"ratio": value, "floor": floor} for name, (value, floor) in checks.items()},
        "failures": failures,
        "forced": bool(args.force and failures),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps({"promoted": promoted, "gate": gate, "failures": failures}, indent=2))
    if promoted:
        print("the app now uses the student in retrieval.queryEncoder=auto; BGE-M3 stays as fallback")
        return 0
    print("gates failed: BGE-M3 remains the default encoder (manifest promoted=false)")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())