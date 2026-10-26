// packages/ui/src/components/citation-chip.test.ts
//
// Unit tests for the citation chip text-segment splitting logic.
// Tests the pure function that splits text on [chunk_id] patterns,
// without rendering (SolidJS server rendering needs babel preset config
// that's not set up for bun test).

import { expect, test, describe } from "bun:test"

// ---------------------------------------------------------------------------
// Re-implement the segment splitter here for testing. The real component
// lives in citation-chip.tsx; this is the same logic extracted as a pure
// function so we can test it without JSX rendering.
// ---------------------------------------------------------------------------

const CITATION_RE = /\[([a-zA-Z0-9_-]+(?:-c\d+)?)\]/g

interface Segment {
  type: "text" | "citation"
  content?: string
  chunkId?: string
}

function splitCitations(text: string): Segment[] {
  const parts: Segment[] = []
  let lastEnd = 0
  const re = new RegExp(CITATION_RE.source, "g")
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastEnd) {
      parts.push({ type: "text", content: text.slice(lastEnd, match.index) })
    }
    parts.push({ type: "citation", chunkId: match[1] })
    lastEnd = match.index + match[0].length
  }
  if (lastEnd < text.length) {
    parts.push({ type: "text", content: text.slice(lastEnd) })
  }
  return parts
}

describe("citation chip segment splitter", () => {
  test("plain text with no citations returns one text segment", () => {
    const segments = splitCitations("Hello world, no citations here.")
    expect(segments.length).toBe(1)
    expect(segments[0]!.type).toBe("text")
    expect(segments[0]!.content).toBe("Hello world, no citations here.")
  })

  test("citation at end produces text + citation", () => {
    const segments = splitCitations("Photosynthesis is cool [bio-c1]")
    expect(segments.length).toBe(2)
    expect(segments[0]!.type).toBe("text")
    expect(segments[0]!.content).toBe("Photosynthesis is cool ")
    expect(segments[1]!.type).toBe("citation")
    expect(segments[1]!.chunkId).toBe("bio-c1")
  })

  test("citation in middle produces text + citation + text", () => {
    const segments = splitCitations("Photosynthesis [bio-c1] is cool")
    expect(segments.length).toBe(3)
    expect(segments[0]!.content).toBe("Photosynthesis ")
    expect(segments[1]!.chunkId).toBe("bio-c1")
    expect(segments[2]!.content).toBe(" is cool")
  })

  test("multiple citations are all extracted", () => {
    const segments = splitCitations("A [c1] B [c2] C [c3] D")
    const citations = segments.filter((s) => s.type === "citation")
    expect(citations.length).toBe(3)
    expect(citations.map((c) => c.chunkId)).toEqual(["c1", "c2", "c3"])
  })

  test("citation at start produces citation + text", () => {
    const segments = splitCitations("[c1] is the first citation")
    expect(segments.length).toBe(2)
    expect(segments[0]!.type).toBe("citation")
    expect(segments[0]!.chunkId).toBe("c1")
    expect(segments[1]!.content).toBe(" is the first citation")
  })

  test("Arabic text with citations is handled", () => {
    const segments = splitCitations("التمثيل الضوئي [bio-c1] مهم للنباتات")
    expect(segments.length).toBe(3)
    expect(segments[0]!.content).toBe("التمثيل الضوئي ")
    expect(segments[1]!.chunkId).toBe("bio-c1")
    expect(segments[2]!.content).toBe(" مهم للنباتات")
  })

  test("consecutive citations with no text between are handled", () => {
    const segments = splitCitations("See [c1][c2] for both")
    const citations = segments.filter((s) => s.type === "citation")
    expect(citations.length).toBe(2)
    expect(citations[0]!.chunkId).toBe("c1")
    expect(citations[1]!.chunkId).toBe("c2")
  })

  test("brackets without chunk-id format are NOT matched (no closing bracket)", () => {
    const segments = splitCitations("Array access [0 is not a citation")
    // Missing closing bracket → not matched
    expect(segments.length).toBe(1)
    expect(segments[0]!.type).toBe("text")
  })

  test("empty string returns no segments", () => {
    const segments = splitCitations("")
    expect(segments.length).toBe(0)
  })

  test("only a citation returns one citation segment", () => {
    const segments = splitCitations("[c1]")
    expect(segments.length).toBe(1)
    expect(segments[0]!.type).toBe("citation")
    expect(segments[0]!.chunkId).toBe("c1")
  })

  test("chunk IDs with hyphens and numbers are matched", () => {
    const segments = splitCitations("See [bio-s1-c42] and [hist-s3-c7]")
    const citations = segments.filter((s) => s.type === "citation")
    expect(citations.length).toBe(2)
    expect(citations[0]!.chunkId).toBe("bio-s1-c42")
    expect(citations[1]!.chunkId).toBe("hist-s3-c7")
  })
})
