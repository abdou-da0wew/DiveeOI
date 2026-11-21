import { isBundledFontFamily } from "../fonts/catalog"
import type { CmlElement } from "./markup"

export type CmlStyles = Record<string, string>
export interface CmlStyleRule {
  selector: string
  declarations: CmlStyles
  specificity: number
  order: number
}

const ALLOWED = new Set([
  "x",
  "y",
  "width",
  "height",
  "fill",
  "stroke",
  "stroke-width",
  "border-radius",
  "background",
  "color",
  "opacity",
  "rotation",
  "font-family",
  "font-size",
  "font-weight",
  "text-align",
  "line-height",
  "z-index",
  "visibility",
])
const SELECTOR = /^(?:[A-Za-z][A-Za-z0-9_-]*|#[A-Za-z][A-Za-z0-9_-]*|\.[A-Za-z][A-Za-z0-9_-]*)$/

export class CmlStyleError extends Error {
  constructor(message: string) {
    super(`CML stylesheet error: ${message}`)
    this.name = "CmlStyleError"
  }
}

export function parseCmlStylesheet(source: string): CmlStyleRule[] {
  if (source.length > 512_000) throw new CmlStyleError("stylesheet exceeds the 512 KB limit")
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const rules: CmlStyleRule[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  let cursor = 0
  while ((match = pattern.exec(clean))) {
    if (clean.slice(cursor, match.index).trim()) throw new CmlStyleError("nested rules and at-rules are not supported")
    cursor = pattern.lastIndex
    const selectors = match[1].split(",").map((item) => item.trim())
    for (const selector of selectors) {
      if (!SELECTOR.test(selector)) throw new CmlStyleError(`unsupported selector: ${selector}`)
      const declarations: CmlStyles = {}
      for (const declaration of match[2].split(";")) {
        if (!declaration.trim()) continue
        const colon = declaration.indexOf(":")
        if (colon < 1) throw new CmlStyleError(`invalid declaration: ${declaration.trim()}`)
        const property = declaration.slice(0, colon).trim().toLowerCase()
        const value = declaration.slice(colon + 1).trim()
        if (!ALLOWED.has(property)) throw new CmlStyleError(`property ${property} is not supported`)
        if (!value || /url\s*\(|@import|expression\s*\(|var\s*\(|!important/i.test(value)) {
          throw new CmlStyleError(`unsafe or empty value for ${property}`)
        }
        if (property === "font-family") {
          const family = value.replace(/^['"]|['"]$/g, "")
          if (!isBundledFontFamily(family))
            throw new CmlStyleError(`font family is not in the bundled catalogue: ${family}`)
          declarations[property] = family
        } else {
          declarations[property] = value
        }
      }
      const specificity = selector.startsWith("#") ? 100 : selector.startsWith(".") ? 10 : 1
      rules.push({ selector, declarations, specificity, order: rules.length })
    }
  }
  if (clean.slice(cursor).trim()) throw new CmlStyleError("malformed or unsupported CSS rule")
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order)
}

export function stylesForElement(element: CmlElement, rules: CmlStyleRule[]): CmlStyles {
  const classes = new Set((element.attributes.class ?? "").split(/\s+/).filter(Boolean))
  const styles: CmlStyles = {}
  for (const rule of rules) {
    const matches =
      (rule.selector.startsWith("#") && rule.selector.slice(1) === element.attributes.id) ||
      (rule.selector.startsWith(".") && classes.has(rule.selector.slice(1))) ||
      (!rule.selector.startsWith("#") && !rule.selector.startsWith(".") && rule.selector === element.tag)
    if (matches) Object.assign(styles, rule.declarations)
  }
  return styles
}
