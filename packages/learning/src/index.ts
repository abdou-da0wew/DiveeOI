// packages/learning/src/index.ts
//
// @diveeoi/learning — self-hosted, book-grounded learning sessions.
//
// This package contains everything that is not wiring:
//   - settings/   — the Effect Schema that drives config validation, the
//                   REST endpoints and the UI form fields (plan §11.1)
//   - manifest/   — pinned-revision manifest generator + types (plan §5.2)
//   - download/   — plain-HTTPS downloader with resume, retries, hash verify
//                   and local-folder import (plan §5.3)
//   - probe/      — OS/arch/CPU/AVX/RAM/disk/libc detection (plan §5.1.1)
//   - setup/      — persisted setup state machine (plan §5.4)
//   - self-test/  — golden-vector self-test (plan §5.1.6)
//   - store/      — books.db schema and Effect Layer with degraded mode
//                   (plan §6)
//   - lang/       — Arabic text normalizer with a version number (plan §7.3)
//   - parsers/    — PDF / DOCX / TXT parsers (plan §7.2)
//   - chunk/      — layout-aware parent/child chunker (plan §7.5)
//   - embed/      — Transformers.js wrapper + Bun Worker entry (plan §4)
//   - ingest/     — worker pool + jobs with checkpoints (plan §7.7)
//   - retrieve/   — BM25 + dense + RRF + gate (plan §8)
//   - memory/     — student profile + book notes (plan §10)
//   - grounding/  — prompt rules + verifier (plan §9.4, §9.6)
//   - service.ts  — the single Effect service the HTTP API consumes
//   - node.ts     — LayerNode entry point (real vs disabled by feature flag)
//
// Phase 1 (Foundations) — fully implemented:
//   settings, manifest, download, probe, setup, self-test, store, service, node.
//
// Phase 2-6 — interfaces and stubs with clear extension points. Each
// module lists the exact exit criteria from the plan.

export * as Settings from "./settings"
export {
  Info as TargetedLearningSettingsSchema,
  TargetedLearningSchema,
  CONFIG_KEY,
  DEFAULTS as SETTINGS_DEFAULTS,
  PRESETS as SETTINGS_PRESETS,
  withDefaults as withSettingsDefaults,
} from "./settings"
export { SetupState, StepName, StepStatus } from "./setup/state-machine"
export { SetupStateSchema } from "./setup/state-machine-schema"
export { ProbeResult as ProbeResultSchema } from "./probe"
export * as Manifest from "./manifest"
export * as Download from "./download"
export * as Probe from "./probe"
export * as Setup from "./setup/state-machine"
export * as SelfTest from "./self-test"
export { BooksStore, BooksUnavailableError, BooksCorruptError, BooksNewerSchemaError } from "./store"
export { TargetedLearning } from "./service"
export type { TargetedLearningInterface } from "./service"
export type { BooksStoreInterface } from "./store"
