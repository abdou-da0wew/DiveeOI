import { describe, expect, test } from "bun:test";
import { correctTranscript, normalizeArWord } from "../src/autocorrect";

describe("autocorrect", () => {
  test("fixes a near-miss domain term (EN)", () => {
    const r = correctTranscript("what is photosynthesys", "en");
    expect(r.corrected).toBe("what is photosynthesis");
    expect(r.corrections).toEqual([{ from: "photosynthesys", to: "photosynthesis", distance: 1 }]);
  });

  test("fixes clorophyll -> chlorophyll", () => {
    const r = correctTranscript("what is clorophyll", "en");
    expect(r.corrected).toBe("what is chlorophyll");
  });

  test("never touches stopwords", () => {
    const r = correctTranscript("needs water the and it", "en");
    expect(r.corrected).toBe("needs water the and it");
    expect(r.corrections.length).toBe(0);
  });

  test("distance-2 requires a shared first letter", () => {
    // "neats" is distance-2 from "needs" (stopword, immune) and distance-2 from
    // "energy" with a different first letter -> must stay untouched.
    const r = correctTranscript("neats", "en");
    expect(r.corrected).toBe("neats");
  });

  test("Arabic: classic ض/ظ confusion is corrected (word-level lexicon)", () => {
    const r = correctTranscript("البناء الظوئي", "ar");
    expect(r.corrected).toBe("البناء الضوئي");
  });

  test("Arabic: already-correct text is untouched (tashkeel display kept)", () => {
    const r = correctTranscript("البناء الضوئي", "ar");
    expect(r.corrected).toBe("البناء الضوئي");
    expect(r.corrections.length).toBe(0);
  });

  test("Arabic: و-prefixed near-miss is fixed against the bare lexicon word", () => {
    const r = correctTranscript("photosynthesys والكلوروفيل", "auto");
    expect(r.corrected).toBe("photosynthesis الكلوروفيل");
  });

  test("normalizeArWord strips tashkeel and unifies alef/yaa", () => {
    expect(normalizeArWord("الْبَنَاء")).toBe("البناء");
    expect(normalizeArWord("إِنْشَاء")).toBe("انشاء");
    expect(normalizeArWord("إلى")).toBe("الي");
  });

  test("punctuation is preserved", () => {
    const r = correctTranscript("photosynthesys, clorophyll!", "en");
    expect(r.corrected).toBe("photosynthesis, chlorophyll!");
  });
});
