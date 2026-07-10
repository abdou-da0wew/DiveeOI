export interface Options {
  neverWorse?: boolean
  commentStrip?: boolean
  dedupeConsecutive?: boolean
  blockSummary?: boolean
  linePatterns?: string[]
}

export interface Result {
  content: string
  neverWorseFallback: boolean
}

function estimateTokens(text: string): number {
  const stripped = text.replace(/\s+/g, " ").trim()
  if (!stripped) return 0
  return Math.ceil(stripped.split(" ").length / 4)
}

const COMMENT_RE = /^\s*(?:\/\/|#|--|%|;)\s/
const BRACKET_COMMENT_RE = /\/\*[\s\S]*?\*\//g
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

export function apply(text: string, opts: Options): Result {
  let filtered = text

  if (opts.dedupeConsecutive) {
    filtered = filtered
      .split("\n")
      .filter((line, i, arr) => i === 0 || line !== arr[i - 1])
      .join("\n")
  }

  if (opts.commentStrip) {
    filtered = filtered
      .replace(BRACKET_COMMENT_RE, "")
      .replace(HTML_COMMENT_RE, "")
      .split("\n")
      .filter((line) => !COMMENT_RE.test(line))
      .join("\n")
  }

  if (opts.linePatterns && opts.linePatterns.length > 0) {
    const dropREs = opts.linePatterns.map((p) => new RegExp(p))
    filtered = filtered
      .split("\n")
      .filter((line) => !dropREs.some((re) => re.test(line)))
      .join("\n")
  }

  if (opts.blockSummary) {
    const lines = filtered.split("\n")
    const out: string[] = []
    for (let i = 0; i < lines.length; ) {
      const line = lines[i]
      out.push(line)
      i++
      const base = line.replace(/[\d]+/g, "#").replace(/\s+/g, " ").trim()
      if (base.length > 10) {
        let repeat = 0
        while (i < lines.length) {
          const next = lines[i].replace(/[\d]+/g, "#").replace(/\s+/g, " ").trim()
          if (next === base) {
            repeat++
            i++
          } else {
            break
          }
        }
        if (repeat > 2) {
          out.push(`  (... ${repeat + 1} similar lines)`)
        } else {
          for (let j = 0; j < repeat; j++) {
            out.push(lines[i - repeat + j])
          }
        }
      }
    }
    filtered = out.join("\n")
  }

  const rawTokens = estimateTokens(text)
  const filteredTokens = estimateTokens(filtered)
  const neverWorseFallback = opts.neverWorse && filteredTokens > rawTokens

  return {
    content: neverWorseFallback ? text : filtered,
    neverWorseFallback,
  }
}

export * as OutputFilter from "./filter"
