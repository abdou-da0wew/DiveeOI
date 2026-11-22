// packages/learning/test/arabic.test.ts
//
// Unit tests for the Arabic text normalizer (plan §7.3).
// Covers: NFKC fold, diacritics stripping, tatweel removal, alef/ya/ta
// marbuta unification, and the version stamp.

import { expect, test, describe } from "bun:test"
import {
  normalizeForSearch,
  normalize,
  NORMALIZER_VERSION,
  type NormalizeOptions,
} from "../src/lang/arabic"

const ALL_ON: NormalizeOptions = {
  nfkc: true,
  stripDiacritics: true,
  stripTatweel: true,
  normalizeAlef: true,
  normalizeYa: true,
  normalizeTaMarbuta: true,
}

describe("arabic normalizer", () => {
  test("NORMALIZER_VERSION is a positive integer", () => {
    expect(NORMALIZER_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(NORMALIZER_VERSION)).toBe(true)
  })

  test("NFKC folds presentation-form alef to canonical alef", () => {
    // U+FE8E (ARABIC LETTER ALEF FINAL FORM) → U+0627 (ARABIC LETTER ALEF)
    const presentation = "\uFE8E"
    const canonical = "\u0627"
    expect(normalizeForSearch(presentation, ALL_ON)).toBe(canonical)
  })

  test("strips Arabic diacritics (tashkeel)", () => {
    // kitāb with fatha + sukun + shadda
    const withDiacritics = "\u0643\u0650\u062A\u064E\u0627\u0628\u0651"
    const withoutDiacritics = "\u0643\u062A\u0627\u0628"
    expect(normalizeForSearch(withDiacritics, ALL_ON)).toBe(withoutDiacritics)
  })

  test("strips tatweel (kashida)", () => {
    // كــتاب with tatweel
    const withTatweel = "\u0643\u0640\u062A\u0627\u0628"
    const withoutTatweel = "\u0643\u062A\u0627\u0628"
    expect(normalizeForSearch(withTatweel, ALL_ON)).toBe(withoutTatweel)
  })

  test("unifies alef variants (أ إ آ → ا)", () => {
    const hamzaAbove = "\u0623" // أ
    const hamzaBelow = "\u0625" // إ
    const madda = "\u0622" // آ
    const canonical = "\u0627" // ا
    expect(normalizeForSearch(hamzaAbove, ALL_ON)).toBe(canonical)
    expect(normalizeForSearch(hamzaBelow, ALL_ON)).toBe(canonical)
    expect(normalizeForSearch(madda, ALL_ON)).toBe(canonical)
  })

  test("unifies ya and alif maqsura", () => {
    const alifMaqsura = "\u0649" // ى
    const ya = "\u064A" // ي
    expect(normalizeForSearch(alifMaqsura, ALL_ON)).toBe(ya)
  })

  test("unifies ta marbuta to ha in search text", () => {
    const taMarbuta = "\u0629" // ة
    const ha = "\u0647" // ه
    expect(normalizeForSearch(taMarbuta, ALL_ON)).toBe(ha)
  })

  test("display text is unchanged; only norm changes", () => {
    const input = "\u0643\u0650\u062A\u0627\u0628\u0651"
    const { display, norm } = normalize(input, ALL_ON)
    expect(display).toBe(input)
    expect(norm).not.toContain("\u0651") // shadda removed
  })

  test("collapses whitespace", () => {
    const input = "  hello   world  "
    expect(normalizeForSearch(input, ALL_ON)).toBe("hello world")
  })

  test("respects disabled options", () => {
    // If stripDiacritics is off, diacritics should remain
    const withDiacritics = "\u0643\u0650\u062A\u0627\u0628"
    const result = normalizeForSearch(withDiacritics, { ...ALL_ON, stripDiacritics: false })
    expect(result).toContain("\u0650") // kasra still present
  })

  test("mixed Arabic + English text normalizes correctly", () => {
    const input = "The word \u0643\u0650\u062A\u0627\u0628 means book"
    const result = normalizeForSearch(input, ALL_ON)
    expect(result).toBe("The word \u0643\u062A\u0627\u0628 means book")
  })

  test("normalization preserves logical word order of mixed RTL/LTR text (bug #11)", () => {
    const input =
      "في عام \u0661\u0669\u0666\u0669 بلغ عدد سكان المدينة 3.5 بالمئة، The term photosynthesis يعني ذلك؛ سؤال: متى؟ 75٪."
    const result = normalizeForSearch(input, ALL_ON)
    const words = input.trim().split(/\s+/).filter(Boolean)
    // Normalizing the text as a whole must equal normalizing each word
    // independently and keeping their sequence: the normalizer never
    // reorders, drops, or merges tokens across word boundaries.
    const perWord = words.map((w) => normalizeForSearch(w, ALL_ON)).join(" ")
    expect(result).toBe(perWord)
    expect(result.trim().split(/\s+/).filter(Boolean).length).toBe(words.length)
  })

  test("digit runs survive normalization verbatim", () => {
    const input = "نما 12345.67 و 3.5 و v3.5.1 و \u0661\u0662\u0663\u0664\u0665 بالمئة."
    const result = normalizeForSearch(input, ALL_ON)
    for (const run of ["12345.67", "3.5", "v3.5.1", "\u0661\u0662\u0663\u0664\u0665"]) {
      expect(result).toContain(run)
    }
  })

  test("display is byte-identical even with fixReversedRuns enabled (repair is search-only)", () => {
    const input = "\u0627\u0644\u0642\u0650\u0631\u0627\u0621\u0629\u064F \u0643\u064F\u062A\u064F\u0628 The photosynthesis \u0663.\u0665"
    for (const mode of ["auto", "on", "off"] as const) {
      const { display, norm } = normalize(input, { ...ALL_ON, fixReversedRuns: mode })
      expect(display).toBe(input) // display text is never touched by the repair
      expect(norm).toBe(normalizeForSearch(input, { ...ALL_ON, fixReversedRuns: mode }))
    }
  })
})
