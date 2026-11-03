"""Retrieval quality metrics (numpy only, no torch) used by train/eval/promote.

Binary relevance: a hit is relevant when its id is in the judged set. The implementation mirrors
`native/retrieval/src/metrics.rs` so the Python and Rust numbers are directly comparable.
"""

from __future__ import annotations

import numpy as np

METRIC_KEYS = ("recall_at_5", "recall_at_10", "mrr_at_10", "ndcg_at_10")


def recall_at(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    return sum(1 for item in ranked[:k] if item in relevant) / len(relevant)


def reciprocal_rank_at(ranked: list[str], relevant: set[str], k: int) -> float:
    for index, item in enumerate(ranked[:k]):
        if item in relevant:
            return 1.0 / (index + 1)
    return 0.0


def ndcg_at(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    gain = lambda index: 1.0 / np.log2(index + 2.0)  # noqa: E731 - tiny local helper
    dcg = sum(gain(index) for index, item in enumerate(ranked[:k]) if item in relevant)
    ideal = sum(gain(index) for index in range(min(k, len(relevant))))
    return float(dcg / ideal) if ideal else 0.0


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    return float(np.percentile(np.asarray(values, dtype=np.float64), p))


def ranking_metrics(rankings: list[list[str]], relevant_sets: list[set[str]]) -> dict[str, float]:
    """Averages over queries. Empty queries contribute 0 to every metric, exactly like the engine."""
    count = len(rankings)
    if count == 0:
        return {key: 0.0 for key in METRIC_KEYS} | {"queries": 0}
    totals = {key: 0.0 for key in METRIC_KEYS}
    for ranked, relevant in zip(rankings, relevant_sets):
        totals["recall_at_5"] += recall_at(ranked, relevant, 5)
        totals["recall_at_10"] += recall_at(ranked, relevant, 10)
        totals["mrr_at_10"] += reciprocal_rank_at(ranked, relevant, 10)
        totals["ndcg_at_10"] += ndcg_at(ranked, relevant, 10)
    return {key: value / count for key, value in totals.items()} | {"queries": count}


def rank_from_scores(scores: np.ndarray, ids: list[str], k: int = 10) -> list[str]:
    """Top-k ids for one query's score row."""
    order = np.argsort(-scores)[:k]
    return [ids[int(index)] for index in order]


def ratios(student: dict[str, float], teacher: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key in METRIC_KEYS:
        baseline = teacher.get(key, 0.0)
        out[key] = (student.get(key, 0.0) / baseline) if baseline > 0 else 0.0
    return out
