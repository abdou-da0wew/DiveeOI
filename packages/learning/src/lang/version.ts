// packages/learning/src/lang/version.ts
//
// Normalizer version. Bumped whenever the normalization rules change.
// Stored on every book row; a mismatch triggers an FTS rebuild (cheap)
// or a full re-ingest, depending on what changed (plan §7.9).

export const NORMALIZER_VERSION = 1
