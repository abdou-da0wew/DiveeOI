/**
 * Post-ASR auto-correction (stage 2 of the voice pipeline).
 *
 * Stage 1 is the vosk grammar/phrase boost (worker side, M1); stage 3 is an
 * optional tiny-LLM rewrite (M1, off by default). This module is the always-on
 * in-process layer: fuzzy-match ASR tokens against the targeted-learning
 * glossary, with Arabic orthography normalization before comparison.
 * Corrections are always reported (raw + corrected) — never silently applied
 * without the UI showing both.
 */
import { EN_TERMS, AR_TERMS } from "./glossary";

export interface Correction {
  from: string;
  to: string;
  distance: number;
}

export interface CorrectResult {
  corrected: string;
  corrections: Correction[];
}

const TASHKEEL = /[\u064B-\u0652\u0670\u0640]/g;
const ARABIC_CHAR = /[\u0600-\u06FF]/;

export function normalizeArWord(w: string): string {
  return w
    .replace(TASHKEEL, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

function damerauLevenshtein(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

const enSet = new Set(EN_TERMS.map((t) => t.toLowerCase()));
const arSet = new Set(AR_TERMS.map(normalizeArWord));

function allowedDistance(token: string): number {
  if (token.length <= 2) return 0;
  if (token.length <= 4) return 1;
  return 2;
}

/** Correct one token against a lexicon; returns replacement or null. */
function bestMatch(token: string, lexicon: string[], normalize: (w: string) => string): Correction | null {
  const key = normalize(token);
  const set = lexicon === EN_TERMS ? enSet : arSet;
  if (set.has(key)) return null;
  const cap = allowedDistance(key);
  if (cap === 0) return null;
  let best: { word: string; d: number } | null = null;
  let tied = false;
  for (const word of lexicon) {
    const d = damerauLevenshtein(key, normalize(word), cap);
    if (d > cap) continue;
    if (!best || d < best.d) {
      best = { word, d };
      tied = false;
    } else if (d === best.d && word !== best.word) {
      tied = true; // ambiguous — do not guess
    }
  }
  if (!best || tied || best.d === 0) return null;
  // Guard against distance-2 false positives ("needs" -> "leaves"): require a
  // shared first letter (works for Arabic too after normalization).
  if (best.d === 2 && key[0] !== normalize(best.word)[0]) return null;
  return { from: token, to: best.word, distance: best.d };
}

const TOKEN_RE = /([\p{L}][\p{L}'\u064B-\u0652]*)/gu;

/**
 * Correct an ASR transcript against the TL glossary.
 * `lang` selects the lexicon; "auto" picks per-token by script.
 */
export function correctTranscript(raw: string, lang: "en" | "ar" | "auto"): CorrectResult {
  const corrections: Correction[] = [];
  const corrected = raw.replace(TOKEN_RE, (token) => {
    const isAr = ARABIC_CHAR.test(token);
    if (lang === "en" && isAr) return token; // wrong-script token, leave as-is
    const lexicon = lang === "ar" || (lang === "auto" && isAr) ? AR_TERMS : EN_TERMS;
    const m = bestMatch(token, lexicon, isAr ? normalizeArWord : (w) => w.toLowerCase());
    if (!m) return token;
    corrections.push(m);
    return m.to;
  });
  return { corrected, corrections };
}
