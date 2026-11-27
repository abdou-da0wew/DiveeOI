// Targeted-learning domain lexicon: STT grammar boost (M1), auto-correction
// dictionary, and speakable-form mapping for math/units fed to the TTS.
export interface GlossaryTerm {
  en: string;
  ar: string;
}

/** Core lesson terms (seeded from the demo lesson: photosynthesis). */
export const TL_GLOSSARY: GlossaryTerm[] = [
  { en: "photosynthesis", ar: "البناء الضوئي" },
  { en: "chlorophyll", ar: "الكلوروفيل" },
  { en: "chloroplast", ar: "البلاستيدات الخضراء" },
  { en: "glucose", ar: "الجلوكوز" },
  { en: "oxygen", ar: "الأكسجين" },
  { en: "carbon dioxide", ar: "ثاني أكسيد الكربون" },
  { en: "mitochondria", ar: "الميتوكوندريا" },
  { en: "energy", ar: "الطاقة" },
  { en: "sunlight", ar: "أشعة الشمس" },
  { en: "leaf", ar: "الورقة" },
  { en: "equation", ar: "المعادلة" },
  { en: "respiration", ar: "التنفس الخلوي" },
  { en: "nutrients", ar: "العناصر الغذائية" },
  { en: "diagram", ar: "الرسم التوضيحي" },
];

/** Extra standalone words that appear in student questions.
 * Stopwords are included so the fuzzy corrector can never "fix" them. */
export const EN_TERMS: string[] = [
  ...TL_GLOSSARY.map((t) => t.en),
  "lesson", "teacher", "question", "explain", "example", "important",
  "plants", "leaves", "water", "light", "chemical", "process", "capture",
  "convert", "produce", "released", "step", "video", "screen", "review",
  // stopwords — immune to fuzzy correction
  "what", "why", "how", "when", "where", "who", "is", "are", "was", "were",
  "the", "a", "an", "and", "or", "but", "if", "to", "of", "in", "on", "for",
  "with", "by", "it", "its", "this", "that", "these", "those", "you", "your",
  "we", "they", "he", "she", "do", "does", "did", "can", "could", "would",
  "should", "will", "have", "has", "had", "about", "from", "into", "make",
  "makes", "made", "get", "gets", "use", "uses", "used", "see", "show",
  "shows", "tell", "need", "needs", "help", "please", "thanks", "hello",
  "yes", "no", "okay", "again", "more", "most", "some", "any", "all", "each",
  "other", "which", "there", "here", "then", "than", "so", "very", "much",
  "many", "one", "two", "three", "six", "mean", "means", "happen", "happens",
];

export const AR_TERMS: string[] = [
  ...TL_GLOSSARY.map((t) => t.ar),
  // word-level entries (phrases alone can't fix single-word ASR errors)
  "الضوئي", "البناء", "الكلوروفيل", "الجلوكوز", "الأكسجين", "الميتوكوندريا",
  "البلاستيدات", "الخضراء", "الطاقة", "المعادلة", "التنفس", "الخلوي",
  "العناصر", "الغذائية", "الرسم", "التوضيحي", "أشعة", "الشمس", "ثاني",
  "أكسيد", "الكربون", "الورقة", "النبات", "النباتات", "الورق", "الأوراق",
  "درس", "معلم", "سؤال", "اشرح", "مثال", "مهم", "نباتات", "أوراق",
  "الماء", "الضوء", "كيميائية", "عملية", "تلتقط", "تحويل", "ينتج",
  "خطوة", "الفيديو", "الشاشة", "لماذا", "ما", "هو", "وهو", "كيف", "شكرا",
  // stopwords — immune to fuzzy correction
  "هي", "هذا", "هذه", "ماذا", "متى", "أين", "من", "عن", "على", "في", "إلى",
  "مع", "هل", "أن", "إن", "كان", "كانت", "يكون", "أريد", "أنا", "أنت", "نحن",
  "جدا", "أيضا", "الآن", "كذلك", "ثم", "لكن", "أو", "لا", "نعم", "حسنا",
  "اليوم", "كل", "بعد", "قبل", "بين", "حول", "عند", "هناك", "و", "ف", "ب",
];

/**
 * Speakable forms for symbols the TTS should not read literally.
 * Keys are matched against teacher text before synthesis.
 */
export const SPEAKABLE: { pattern: RegExp; en: string; ar: string }[] = [
  { pattern: /\bCO2\b|\bCO₂\b/g, en: "C O two", ar: "ثاني أكسيد الكربون" },
  { pattern: /\bH2O\b|\bH₂O\b/g, en: "H two O", ar: "الماء" },
  { pattern: /\bO2\b|\bO₂\b/g, en: "O two", ar: "الأكسجين" },
  { pattern: /x\^2|x²/g, en: "x squared", ar: "x تربيع" },
  { pattern: /\b6CO2/g, en: "six C O two", ar: "ستة جزيئات ثاني أكسيد الكربون" },
  { pattern: /%/g, en: " percent", ar: " بالمئة" },
];

/** Expand speakable symbols in teacher text for a target language. */
export function speakableForm(text: string, lang: "en" | "ar"): string {
  let out = text;
  for (const rule of SPEAKABLE) {
    out = out.replace(rule.pattern, lang === "ar" ? rule.ar : rule.en);
  }
  return out;
}
