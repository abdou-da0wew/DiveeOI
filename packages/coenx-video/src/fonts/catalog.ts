export interface FontFamilyInfo {
  family: string
  style: string
  recommendedFor: string
  tags: readonly string[]
  scripts: readonly ("latin" | "arabic")[]
  weights: string
  license: "SIL-OFL-1.1"
}

export const FONT_CATALOG: readonly FontFamilyInfo[] = [
  {
    family: "Geist",
    style: "Variable neo-grotesk",
    recommendedFor: "Modern product UI, neutral titles and clean body copy",
    tags: ["ui", "body", "headline"],
    scripts: ["latin"],
    weights: "100 900",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Geist Mono",
    style: "Variable technical monospace",
    recommendedFor: "Code labels, counters, data and technical UI",
    tags: ["code", "data", "technical"],
    scripts: ["latin"],
    weights: "100 900",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Space Grotesk",
    style: "Geometric sans",
    recommendedFor: "Tech explainers, bold UI headlines and product stories",
    tags: ["headline", "tech", "ui"],
    scripts: ["latin"],
    weights: "300 700",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Space Mono",
    style: "Display monospace",
    recommendedFor: "Terminal visuals, labels and retro technical accents",
    tags: ["code", "terminal", "accent"],
    scripts: ["latin"],
    weights: "400 700",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Manrope",
    style: "Geometric sans",
    recommendedFor: "Polished UI, long-form captions and friendly explainers",
    tags: ["ui", "body", "caption"],
    scripts: ["latin"],
    weights: "200 800",
    license: "SIL-OFL-1.1",
  },
  {
    family: "DM Sans",
    style: "Humanist sans",
    recommendedFor: "Versatile body copy, educational text and readable captions",
    tags: ["body", "ui", "caption"],
    scripts: ["latin"],
    weights: "400 1000",
    license: "SIL-OFL-1.1",
  },
  {
    family: "DM Mono",
    style: "Monospace",
    recommendedFor: "Small metrics, timestamps, code and data annotations",
    tags: ["code", "data", "caption"],
    scripts: ["latin"],
    weights: "400 500",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Fraunces",
    style: "Soft display serif",
    recommendedFor: "Editorial stories, quotes and premium titles",
    tags: ["editorial", "serif", "headline"],
    scripts: ["latin"],
    weights: "100 900",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Bricolage Grotesque",
    style: "Expressive variable grotesque",
    recommendedFor: "Playful campaign titles and expressive explainers",
    tags: ["display", "headline", "playful"],
    scripts: ["latin"],
    weights: "200 800",
    license: "SIL-OFL-1.1",
  },
  {
    family: "IBM Plex Sans",
    style: "Technical grotesque",
    recommendedFor: "Scientific content, diagrams, structured data and UI",
    tags: ["technical", "body", "ui"],
    scripts: ["latin"],
    weights: "100 700",
    license: "SIL-OFL-1.1",
  },
  {
    family: "JetBrains Mono",
    style: "Developer monospace",
    recommendedFor: "Code, debugging, terminal and precise numeric labels",
    tags: ["code", "terminal", "data"],
    scripts: ["latin"],
    weights: "100 800",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Bebas Neue",
    style: "Condensed display sans",
    recommendedFor: "Short high-impact titles and poster-like motion graphics",
    tags: ["display", "poster", "headline"],
    scripts: ["latin"],
    weights: "400",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Cairo",
    style: "Arabic-first geometric sans",
    recommendedFor: "Arabic UI, readable Arabic captions and educational headings",
    tags: ["arabic", "ui", "body"],
    scripts: ["arabic", "latin"],
    weights: "200 1000",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Tajawal",
    style: "Arabic geometric sans",
    recommendedFor: "Friendly Arabic product UI, body copy and clear captions",
    tags: ["arabic", "ui", "body"],
    scripts: ["arabic", "latin"],
    weights: "400 700",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Amiri",
    style: "Arabic Naskh serif",
    recommendedFor: "Arabic quotations, literary titles and editorial scenes",
    tags: ["arabic", "serif", "editorial"],
    scripts: ["arabic", "latin"],
    weights: "400 700",
    license: "SIL-OFL-1.1",
  },
  {
    family: "Noto Sans Arabic",
    style: "Neutral Arabic sans",
    recommendedFor: "Dense Arabic educational text, neutral UI and broad script coverage",
    tags: ["arabic", "body", "ui"],
    scripts: ["arabic", "latin"],
    weights: "100 900",
    license: "SIL-OFL-1.1",
  },
] as const

const RENDER_FAMILY_ALIASES: Record<string, string> = {
  "Space Grotesk": "Space Grotesk Light",
  Manrope: "Manrope ExtraLight",
  "DM Sans": "DM Sans 9pt",
  "Bricolage Grotesque": "Bricolage Grotesque 96pt ExtraBold",
}

export function renderFontFamilyName(family: string, weight: number | string = 400) {
  const numericWeight = Number(weight)
  if (family === "DM Mono" && numericWeight >= 500) return "DM Mono Medium"
  if (family === "Tajawal" && numericWeight === 500) return "Tajawal Medium"
  return RENDER_FAMILY_ALIASES[family] ?? family
}

const FAMILY_NAMES = new Set(FONT_CATALOG.map((font) => font.family.toLocaleLowerCase("en-US")))

export function isBundledFontFamily(value: string): boolean {
  return FAMILY_NAMES.has(
    value
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .toLocaleLowerCase("en-US"),
  )
}

export function findFontFamily(value: string) {
  const normalized = value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .toLocaleLowerCase("en-US")
  return FONT_CATALOG.find((font) => font.family.toLocaleLowerCase("en-US") === normalized)
}

export function recommendFontFamily(tags: readonly string[], script: "latin" | "arabic" = "latin") {
  return FONT_CATALOG.filter((font) => font.scripts.includes(script))
    .map((font) => ({ font, score: tags.filter((tag) => font.tags.includes(tag)).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.font.family.localeCompare(b.font.family))
    .map((item) => item.font)
}
