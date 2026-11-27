/**
 * Streaming sentence chunker for EN/AR teacher text.
 *
 * The LLM streams deltas; we split into TTS-sized sentences as soon as a hard
 * boundary arrives so the first audio can start while the rest is still
 * streaming. supertonic-3 has no native streaming, so this chunk pipeline
 * (chunk -> synth -> play, overlapped) is the latency mechanism.
 *
 * Rules (see docs/voice-mode/PLAN.md §4):
 *  - hard boundaries: . ! ? ؟ ؛  (+ whitespace/end)
 *  - soft boundaries: , ، ; — used only when a chunk exceeds softMaxChars
 *  - abbreviations (e.g., i.e., Dr., د.) and decimals are never boundaries
 *  - minChars: do not dispatch a tiny fragment; maxChars: force split
 */
export interface ChunkerOptions {
  minChars?: number;
  maxChars?: number;
  softMaxChars?: number;
}

const DEFAULTS: Required<ChunkerOptions> = {
  minChars: 14,
  maxChars: 220,
  softMaxChars: 110,
};

const HARD_BOUNDARY = /([.!?؟؛]+)(\s+|$)/g;
const SOFT_BOUNDARY = /([,،;])(\s+|$)/g;

/** Abbreviation patterns; replaced with a same-length mask so boundary scan
 * never fires inside them. The middle dot (·) is not a boundary char. */
const ABBREVIATIONS: RegExp[] = [
  /\be\.g\./gi,
  /\bi\.e\./gi,
  /\betc\./gi,
  /\bDr\./g,
  /\bMr\./g,
  /\bMrs\./g,
  /\bMs\./g,
  /\bSt\./g,
  /\bvs\./gi,
  /أ\.د\./g,
  /د\./g,
  /ب\.م\./g,
];

function maskAbbreviations(text: string): string {
  let masked = text;
  for (const re of ABBREVIATIONS) {
    masked = masked.replace(re, (m) => m.replace(/\./g, "·"));
  }
  // Decimal numbers: 3.14 -> 3·14 (same length, dot not a boundary)
  masked = masked.replace(/(\d)\.(\d)/g, "$1·$2");
  return masked;
}

export class StreamingChunker {
  private buf = "";
  private readonly o: Required<ChunkerOptions>;

  constructor(options: ChunkerOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
  }

  /** Feed one streamed delta; returns chunks that became dispatchable. */
  push(delta: string): string[] {
    this.buf += delta;
    return this.extract(false);
  }

  /** Stream ended; returns whatever is left as a final chunk. */
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    return rest ? [rest] : [];
  }

  get pending(): string {
    return this.buf;
  }

  private extract(finalOnly: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const candidate = this.cutCandidate(!finalOnly);
      if (!candidate) break;
      const trimmed = candidate.trim();
      if (trimmed) out.push(trimmed);
    }
    return out;
  }

  /** Cut one chunk out of buf (or null when nothing dispatchable). */
  private cutCandidate(scanBoundaries: boolean): string | null {
    if (!this.buf.trim()) return null;
    if (!scanBoundaries) {
      const rest = this.buf;
      this.buf = "";
      return rest;
    }

    const masked = maskAbbreviations(this.buf);

    // Find the earliest hard boundary at/after minChars.
    let cut = -1;
    HARD_BOUNDARY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HARD_BOUNDARY.exec(masked)) !== null) {
      const end = m.index + m[0].length;
      if (this.buf.slice(0, end).trim().length >= this.o.minChars) {
        cut = end;
        break;
      }
    }

    // No hard boundary yet — apply soft/force rules if the buffer grew too big.
    if (cut === -1) {
      const len = this.buf.trim().length;
      if (len < this.o.softMaxChars) return null;
      let softCut = -1;
      if (len >= this.o.softMaxChars) {
        SOFT_BOUNDARY.lastIndex = 0;
        let s: RegExpExecArray | null;
        while ((s = SOFT_BOUNDARY.exec(masked)) !== null) {
          const end = s.index + s[0].length;
          if (this.buf.slice(0, end).trim().length >= this.o.minChars) softCut = end;
        }
      }
      if (softCut !== -1) cut = softCut;
      else if (len >= this.o.maxChars) {
        // Force split at the last space before maxChars.
        const window = this.buf.slice(0, this.o.maxChars);
        const lastSpace = window.lastIndexOf(" ");
        cut = lastSpace > this.o.minChars ? lastSpace : this.o.maxChars;
      } else return null;
    }

    const chunk = this.buf.slice(0, cut);
    this.buf = this.buf.slice(cut);
    return chunk;
  }
}
