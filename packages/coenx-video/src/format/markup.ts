export interface CmlElement {
  tag: string
  attributes: Record<string, string>
  children: Array<CmlElement | string>
}

export class CmlSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`CML syntax error at character ${offset}: ${message}`)
    this.name = "CmlSyntaxError"
  }
}

const NAME = /^[A-Za-z][A-Za-z0-9:_-]*/

function decodeEntities(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
}

function parseAttributes(source: string, offset: number) {
  const attributes: Record<string, string> = {}
  let index = 0
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index++
    if (index >= source.length) break
    const match = source.slice(index).match(NAME)
    if (!match) throw new CmlSyntaxError("expected an attribute name", offset + index)
    const name = match[0]
    index += name.length
    while (/\s/.test(source[index] ?? "")) index++
    if (source[index] !== "=") throw new CmlSyntaxError(`attribute ${name} must have a value`, offset + index)
    index++
    while (/\s/.test(source[index] ?? "")) index++
    const quote = source[index]
    if (quote !== '"' && quote !== "'") throw new CmlSyntaxError("attribute values must be quoted", offset + index)
    index++
    const start = index
    while (index < source.length && source[index] !== quote) {
      if (source[index] === "\\")
        throw new CmlSyntaxError("escaped attribute delimiters are not supported", offset + index)
      index++
    }
    if (index >= source.length) throw new CmlSyntaxError("unterminated attribute value", offset + start)
    if (Object.hasOwn(attributes, name)) throw new CmlSyntaxError(`duplicate attribute ${name}`, offset + start)
    attributes[name] = decodeEntities(source.slice(start, index))
    index++
  }
  return attributes
}

function findTagEnd(source: string, start: number) {
  let quote = ""
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ""
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === ">") return index
  }
  return -1
}

export function parseCmlMarkup(source: string): CmlElement {
  if (source.length > 2_000_000) throw new CmlSyntaxError("document exceeds the 2 MB limit", 0)
  const roots: CmlElement[] = []
  const stack: CmlElement[] = []
  let index = 0
  let nodeCount = 0

  const appendText = (value: string) => {
    if (!value) return
    const text = decodeEntities(value)
    const parent = stack.at(-1)
    if (parent) parent.children.push(text)
    else if (text.trim()) throw new CmlSyntaxError("text is only allowed inside an element", index)
  }

  while (index < source.length) {
    const opening = source.indexOf("<", index)
    if (opening < 0) {
      appendText(source.slice(index))
      break
    }
    appendText(source.slice(index, opening))
    if (source.startsWith("<!--", opening)) {
      const end = source.indexOf("-->", opening + 4)
      if (end < 0) throw new CmlSyntaxError("unterminated comment", opening)
      index = end + 3
      continue
    }
    const end = findTagEnd(source, opening + 1)
    if (end < 0) throw new CmlSyntaxError("unterminated tag", opening)
    const raw = source.slice(opening + 1, end).trim()
    if (!raw) throw new CmlSyntaxError("empty tag", opening)
    if (raw.startsWith("!DOCTYPE") || raw.startsWith("?")) {
      throw new CmlSyntaxError("doctype and processing instructions are not supported", opening)
    }
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim()
      const current = stack.pop()
      if (!current || current.tag !== name) {
        throw new CmlSyntaxError(`unexpected closing tag </${name}>`, opening)
      }
      index = end + 1
      continue
    }

    const selfClosing = raw.endsWith("/")
    const body = selfClosing ? raw.slice(0, -1).trimEnd() : raw
    const nameMatch = body.match(NAME)
    if (!nameMatch) throw new CmlSyntaxError("invalid element name", opening)
    const tag = nameMatch[0].toLowerCase()
    const attributes = parseAttributes(body.slice(nameMatch[0].length), opening + 1 + nameMatch[0].length)
    const element: CmlElement = { tag, attributes, children: [] }
    nodeCount++
    if (nodeCount > 5_000) throw new CmlSyntaxError("document exceeds the 5,000 element limit", opening)
    const parent = stack.at(-1)
    if (parent) parent.children.push(element)
    else roots.push(element)
    if (!selfClosing) {
      if (stack.length >= 32) throw new CmlSyntaxError("element nesting exceeds 32 levels", opening)
      stack.push(element)
    }
    index = end + 1
  }

  if (stack.length) throw new CmlSyntaxError(`unclosed <${stack.at(-1)?.tag}>`, source.length)
  if (roots.length !== 1) throw new CmlSyntaxError("document must contain exactly one root element", 0)
  if (roots[0].tag !== "coenx") throw new CmlSyntaxError("root element must be <coenx>", 0)
  return roots[0]
}

export function elementText(element: CmlElement) {
  return element.children
    .filter((child): child is string => typeof child === "string")
    .join("")
    .trim()
}

export function childElements(element: CmlElement, tag?: string) {
  return element.children.filter(
    (child): child is CmlElement => typeof child !== "string" && (!tag || child.tag === tag),
  )
}
