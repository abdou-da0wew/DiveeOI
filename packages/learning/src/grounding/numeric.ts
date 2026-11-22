// packages/learning/src/grounding/numeric.ts
//
// Numeric-claim figure detection + normalization for the grounding verifier (plan §9.6).
// Implements TODO #4: grounding enforcement must require term-verification for numeric
// claims (pre-retrieval figures leaking into Arabic numeric answers). A figure asserted
// in a reply / quoted span must actually appear in the cited chunk text.
//
// Detected figures: Latin digits (0-9), Arabic-Indic digits (٠-٩ U+0660-0669), Persian
// digits (۰-۹ U+06F0-06F9), fullwidth digits (０-９), thousands separators ("1,000" /
// "1.000" / "1٬000"), decimals ("3.5" / "3,5" / "٣٫٥") and percent ("85%" / "٨٥٪").
// Normalization treats `1000` ≡ `1,000` ≡ `1.000` ≡ `١٠٠٠` ≡ `۱۰۰۰` as the same figure.
//
// Rules (documented trade-offs — numeric notation is genuinely ambiguous):
//   - "," and U+066C (٬) are thousands grouping when followed by groups of exactly 3
//     digits; any other comma shape reads as a European decimal comma ("3,5" → 3.5).
//   - "." is thousands grouping iff the whole token is 1-3 digits + 3-digit groups
//     ("1.000" → 1000, "1.000.000" → 1000000); otherwise it is a decimal point.
//     U+066B (٫) is UNAMBIGUOUSLY a decimal separator (Unicode semantics).
//     Accepted ambiguity: "0.500"-style three-decimal figures read as whole numbers —
//     both sides of the check normalize identically, so only cross-form comparisons
//     (e.g. reply "0.5" vs chunk "0.500") can diverge.
//   - Percent is an annotation, not part of the figure: "85%" ≡ "85" ≡ "٨٥٪".
//   - Signs are ignored ("-5" ≡ "5") so ranges like "1939-1945" tokenize into two
//     figures instead of a negative number.
//   - Space-grouped thousands ("1 000") are NOT joined; each group stays a figure.

/** Placeholder for U+066B (٫), which can ONLY mean decimal, unlike the Latin dot. */
const DECIMAL_MARK = String.fromCharCode(1)

/** Figure token on the separator-normalized text: digits with embedded separators,
 *  optionally percent-annotated. */
const TOKEN_RE = new RegExp(`\\d+(?:[.,${DECIMAL_MARK}]\\d+)*(?:%+)?`, "g")

/** Line-start enumeration markers ("1. ", "2) ", "## 12. ") — decoration, not claims. */
const ENUM_MARKER_RE = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?\d{1,2}[.)][ \t]+/g

/**
 * Translate every non-Latin digit variant and Arabic separator to its ASCII twin.
 * Length-preserving in UTF-16 units (every code point maps 1:1), so token offsets in
 * the translated string index into the ORIGINAL string. U+066B (٫) maps to DECIMAL_MARK.
 */
const translate = (text: string): string => {
  let out = ""
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code >= 0x0660 && code <= 0x0669) out += String.fromCharCode(48 + code - 0x0660) // ٠-٩
    else if (code >= 0x06f0 && code <= 0x06f9) out += String.fromCharCode(48 + code - 0x06f0) // ۰-۹
    else if (code >= 0xff10 && code <= 0xff19) out += String.fromCharCode(48 + code - 0xff10) // ０-９
    else if (code === 0x066b) out += DECIMAL_MARK // ٫ Arabic decimal separator
    else if (code === 0x066c) out += "," // ٬ Arabic thousands separator
    else if (code === 0x066a) out += "%" // ٪ Arabic percent sign
    else out += ch
  }
  return out
}

/**
 * Canonical figure key for a (translated) token: separator-independent and
 * zero-normalized, so "1,000", "1.000", "١٠٠٠" and "۱۰۰۰" all produce "1000", and
 * "3.50", "3.0", "03.5" produce "3.5".
 */
const canonicalKey = (token: string): string => {
  let s = token.replace(/%+$/, "") // percent annotation → bare figure
  const forcedDecimal = s.includes(DECIMAL_MARK)
  s = s.split(DECIMAL_MARK).join(".")
  if (s.includes(",")) {
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "") // "1,000" / "1,000.5"
    else s = s.replace(/,/g, ".") // European decimal comma: "3,5" → 3.5
  }
  if (!forcedDecimal && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "") // "1.000" → 1000
  const dot = s.indexOf(".")
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "")
  if (s.includes(".")) s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") // 3.50 → 3.5, 10.00 → 10
  s = s.replace(/^0+(?=\d)/, "") // 007 → 7 (a single "0" is kept)
  return s
}

/**
 * Figures asserted in a text, as ORIGINAL token strings (order of appearance, deduped
 * by canonical key). Line-start enumeration markers are masked so list/heading numbers
 * are not treated as claims.
 */
export const extractClaimFigures = (text: string): string[] => {
  const translated = translate(text)
  const masked = new Uint8Array(translated.length)
  for (const m of translated.matchAll(ENUM_MARKER_RE)) {
    const at = m.index ?? 0
    for (let i = at; i < at + m[0].length; i++) masked[i] = 1
  }
  const byKey = new Map<string, string>()
  for (const m of translated.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0
    let isMarker = true
    for (let i = at; i < at + m[0].length; i++) {
      if (!masked[i]) {
        isMarker = false
        break
      }
    }
    if (isMarker) continue
    const original = text.slice(at, at + m[0].length)
    const key = canonicalKey(m[0])
    if (!byKey.has(key)) byKey.set(key, original)
  }
  return [...byKey.values()]
}

/** Canonical figure keys present anywhere in a text (chunk side; no enumeration masking,
 *  so every figure in the chunk is available to ground a claim). */
export const chunkFigureKeys = (text: string): Set<string> => {
  const keys = new Set<string>()
  for (const m of translate(text).matchAll(TOKEN_RE)) keys.add(canonicalKey(m[0]))
  return keys
}

/**
 * Claim figures whose canonical key does NOT appear in the chunk text. Returns the
 * ORIGINAL tokens (e.g. "9,999" or "١٥٠٠") so failure messages can name the figure.
 */
export const findMissingFigures = (claimTokens: string[], chunkText: string): string[] => {
  const keys = chunkFigureKeys(chunkText)
  const missing: string[] = []
  const seen = new Set<string>()
  for (const token of claimTokens) {
    const key = canonicalKey(translate(token))
    if (!keys.has(key) && !seen.has(key)) {
      seen.add(key)
      missing.push(token)
    }
  }
  return missing
}
