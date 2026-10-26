// packages/learning/src/lang/arabic.ts
//
// Arabic text hygiene (plan §7.3).
//
// Two outputs:
//   - display text (the original) — used for citations and previews
//   - text_norm — feeds search. Drops diacritics and tatweel, unifies alef
//     / ya / ta marbuta variants, NFKC-folds presentation forms.
//
// Search text never replaces display text. Citations always use the original.
//
// The normalizer is versioned (lang/version.ts). When the rules change,
// bump NORMALIZER_VERSION; the ingest manager marks every book as needing
// an FTS rebuild (cheap) — or a full re-ingest if the parser version also
// changed (plan §7.9).
//
// Phase 2 implementation. Phase 1 ships the interface + version stamp so
// the schema and config can reference them; the actual transformations
// land in Phase 2 along with the parser work.

import { NORMALIZER_VERSION } from "./version"
import type { Info as LanguageSettingsShape } from "../settings/schema"

export interface NormalizeOptions {
  nfkc?: boolean
  stripDiacritics?: boolean
  stripTatweel?: boolean
  normalizeAlef?: boolean
  normalizeYa?: boolean
  normalizeTaMarbuta?: boolean
  fixReversedRuns?: "auto" | "on" | "off"
  lightStemming?: boolean
}

// Re-export for callers that want the schema-level shape.
export type LanguageSettings = LanguageSettingsShape

/**
 * NFKC fold. Presentation-form letters (ﭐ ﭑ ﺍ ﺎ ﺏ ...) collapse to their
 * canonical Arabic letters. JavaScript's String.normalize("NFKC") does this
 * for free.
 */
const nfkc = (text: string): string => text.normalize("NFKC")

// Arabic diacritics (tashkeel) Unicode block + extras.
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u08D3-\u08E1\u08E3-\u08FF]/g

// Tatweel (kashida) — used for visual elongation, never for search.
const TATWEEL = /\u0640/g

// Alef variants → ا
const ALEF = /[\u0622\u0623\u0625\u0671\u0672\u0673\u0675]/g

// Ya variants → ي (alif maqsura is a separate debate; default on)
const YA = /[\u0649\u064A]/g

// Ta marbuta → ha (for search only)
const TA_MARBUTA = /\u0629/g

// Reversed-run detection heuristic: if a line has Latin letters mixed with
// Arabic and the order looks wrong, flip the bracketed Latin run. This is
// a stop-gap; the real fix is in the parser, which sees positions.
const fixReversedRuns = (text: string, mode: "auto" | "on" | "off"): string => {
  if (mode === "off") return text
  // Conservative: only flip when we see Latin-text-then-Arabic-text on one
  // line where the Arabic clearly wraps the Latin. Phase 2 will tighten
  // this with bidirectional bracket detection.
  return text
}

/**
 * Normalize text for search (FTS5 + dense embedding input).
 * Display text is the input unchanged.
 */
export const normalizeForSearch = (text: string, opts: NormalizeOptions = {}): string => {
  let out = text
  if (opts.nfkc !== false) out = nfkc(out)
  if (opts.stripDiacritics !== false) out = out.replace(DIACRITICS, "")
  if (opts.stripTatweel !== false) out = out.replace(TATWEEL, "")
  if (opts.normalizeAlef !== false) out = out.replace(ALEF, "\u0627")
  if (opts.normalizeYa !== false) out = out.replace(YA, "\u064A")
  if (opts.normalizeTaMarbuta !== false) out = out.replace(TA_MARBUTA, "\u0647")
  if (opts.fixReversedRuns && opts.fixReversedRuns !== "off") {
    out = fixReversedRuns(out, opts.fixReversedRuns)
  }
  // Light stemming is off by default and is a Phase 2 task.
  // Collapse whitespace
  return out.replace(/\s+/g, " ").trim()
}

/**
 * Same as normalizeForSearch but ALSO returns the display version.
 * Used by the chunker so we don't normalize twice.
 */
export const normalize = (text: string, opts: NormalizeOptions = {}): { display: string; norm: string } => ({
  display: text,
  norm: normalizeForSearch(text, opts),
})

export { NORMALIZER_VERSION }
