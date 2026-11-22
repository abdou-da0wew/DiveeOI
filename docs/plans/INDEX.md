# Plans Index

Single index of every plan / roadmap / historical design document in the repo, separating live from
superseded material. Created 2026-11-22 (TODO.md §8) to implement the 2026-10-31 audit
recommendation ([`docs/audit/2026-10-31-comprehensive-findings.md`](../audit/2026-10-31-comprehensive-findings.md) §6:
"No single top-level index distinguishes live from superseded plans. Recommend a `docs/plans/INDEX.md`
or an archive subfolder") — both halves of the recommendation are done: this index plus
`docs/plans/archive/`.

**Status vocabulary**

- **LIVE** — still the authoritative reference for open work; keep updated.
- **SUPERSEDED** — implemented, replaced, or explicitly stamped historical; kept as a record, not a status report.
- **UNBUILT-ROADMAP** — implementation-grade plan for work that has not been built.
- **ARCHIVED** — point-in-time snapshot moved out of the way; read-only history.

**Archive note:** the root `.draft-01.md` … `.draft-09.md` architecture snapshots were moved to
[`docs/plans/archive/`](archive/) on **2026-11-22** (plain `mv`, uncommitted working-tree rename), per the
2026-10-31 audit recommendation quoted above. `.draft-10-autonomous-agent.md` deliberately stays at the
repo root: TODO.md §9 treats it as the live unbuilt roadmap (it is also cross-referenced from
`docs/PROJECT_MAP.md`).

## Index

| Path | One-line description | Status | Last touched | Evidence for status |
|---|---|---|---|---|
| `plans/MemoryPlan/MEMORY_IMPLEMENTATION_PLAN.md` | Zettelkasten-style memory system (`@diveeoi/memory`) implementation plan | LIVE | 2026-10-30 (51ccd85) | Header "Status refresh — 2026-10-30"; package exists (`packages/memory/`); TODO.md §5 memory items still route open verification work here |
| `plans/MemoryPlan/MEMORY_SERVER_INTEGRATION_PLAN.md` | Memory↔server integration status + pending-validation checklist | LIVE | 2026-10-30 (51ccd85) | "Last reviewed: 2026-10-30"; TODO.md §5 consolidation decision explicitly cites it (`TODO.md:126`); integration verification list is still open |
| `plans/MemoryPlan/MEMORY_REVIEW_1.md` | Memory package code review — algorithmic & correctness | SUPERSEDED | 2026-10-30 (51ccd85) | Header stamps it "Historical review snapshot … not all revalidated"; TODO.md §5 asks for a re-check against current source before trusting findings |
| `plans/MemoryPlan/MEMORY_REVIEW_2.md` | Memory package architecture review (layer composition etc.) | SUPERSEDED | 2026-10-30 (51ccd85) | Same "Historical review snapshot" header; kept as record |
| `plans/MemoryPlan/MEMORY_REVIEW_3.md` | Memory package security & reliability review (path traversal, injection, non-atomic merges) | SUPERSEDED | 2026-10-30 (51ccd85) | Same "Historical review snapshot" header; TODO.md §5 explicitly re-checks these criticals against current source |
| `plans/MigrateBranding/CHANGES_TO_PORT.md` | opencode-source → DiveeOI port change log (module-by-module port mapping) | SUPERSEDED | 2026-08-07 (c00ba49) | Fork/port is long complete; `docs/PROJECT_MAP.md:17` cites it as the historical "fork port log" |
| `plans/Optimization_1.0/OPTIMIZATION_PLAN.md` | Adaptive-resource optimization design/rollout plan | SUPERSEDED | 2026-10-30 (51ccd85) | Own header: "original design/rollout plan, not a current completion ledger … See `docs/optimization.md` for current implementation context"; still cross-linked from `docs/architecture.md` + `docs/optimization.md` |
| `plans/fix-InstanceRef_Startup_capture_plus_traceInteg/PLAN.md` | Bug-fix plan: InstanceRef startup capture + tracer integration | SUPERSEDED | 2026-08-07 (c00ba49; fix landed 2026-07-11, 892e6d4) | Fix is in the code: `packages/server/src/session/prompt.ts:2014` (`ensureInstanceRef` prefers a live `InstanceRef`, falls back only when absent) |
| `docs/plans/coenx-video-renderer-roadmap.md` | Coenx video renderer + AI tooling roadmap (WP1–WP8, gates, decision log) | LIVE | 2026-11-21 (c0951df) | Self-declared "Active, living implementation plan"; TODO.md §3 names it an authoritative source; referenced by `docs/handoffs/coenx-video-renderer-handoff-2026-11-21.md` |
| `docs/plans/archive/.draft-01-server-core.md` … `.draft-08-app-effects-profiler.md` | Point-in-time architecture read-snapshots (server core, session/LLM/config, DB/memory/API, memory service/app shell, theme/MCP, permission/LayerNode, prompt loop, app-state/profiler) | ARCHIVED | 2026-09-19 (24080a5; `.draft-03` got an incidental one-line refresh 2026-11-07, 22e132d) | Code-reading snapshots, not plans; superseded by the source tree, `docs/PROJECT_MAP.md` and `docs/architecture.md`; no live cross-references |
| `docs/plans/archive/.draft-09-optimization.md` | Optimization-system write-up (pre-implementation draft of the adaptive stack) | ARCHIVED | 2026-10-30 (51ccd85) | Self-stamped: "Historical pre-implementation draft … use `docs/optimization.md` and the source tree for current behavior" |
| `.draft-10-autonomous-agent.md` (repo root — intentionally **not** archived) | Autonomous-agent program v2 (P0–P11: linktree anchor memory, model-fallback rotation, watchdog, restartable agent tasks, machine tools, access surfaces, prompt rewrite) | UNBUILT-ROADMAP | 2026-09-22 (6008471; "Verified against the codebase 2026-09-21") | TODO.md §9 lists it as planned-but-unbuilt: "the roadmap itself has no execution record"; some fragments (SSH REPL listener, `agent_task` tables) landed independently |

**Maintenance rule:** when a plan's status changes (implemented / abandoned / superseded), update its
row here in the same change that updates the plan. New plan docs go in `plans/` or `docs/plans/` and
get a row on creation.

**Related:** `skills/README.md` documents the `skills/hyperframes-*` vendored skill suite (external
`npx hyperframes` ecosystem content, not wired into the product).
