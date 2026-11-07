- Prioritize stability, then simplicity, then measurement overhead.
- Use Playwright for scenario control, isolation, and completion checks.
- Use Chrome Performance traces for generic browser profiling.
- Use Electron `contentTracing` for packaged multi-process profiling.
- Keep custom probes only for product-specific measurements.
- Do not duplicate measurements across the harness, probes, and traces.
- Run benchmarks serially to avoid cross-test contention.
- Run benchmarks against production builds.
- Keep detailed profiling opt-in when it changes workload behavior.
- Preserve raw diagnostic data or use lossless representations.
- Do not enforce machine-dependent performance thresholds.
- Assert scenario completion and metric collection only.
- Keep normal test discovery free of manual benchmarks.

## Current DiveeComposer incident handoff (2026-11-02)

For work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` for the historical incident analysis and `CONTEXT.md` / `RELEASE_HANDOFF_2026-11-06.md` for the current source/runtime and verification boundary. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not infer deployment provenance from the current source HEAD.
