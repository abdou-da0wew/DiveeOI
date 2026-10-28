// packages/learning/src/grounding/turn-state.ts
//
// Which passages the model was actually shown this turn (retrieved context plus anything its
// tools read). The verifier (plan §9.6) only accepts citations of passages in this set.

const retrieved = new Map<string, Set<string>>()

export const resetRetrieved = (sessionId: string) => retrieved.set(sessionId, new Set())
export const recordRetrieved = (sessionId: string, chunkIds: Iterable<string>) => {
  const set = retrieved.get(sessionId) ?? new Set<string>()
  for (const id of chunkIds) set.add(id)
  retrieved.set(sessionId, set)
}
export const getRetrieved = (sessionId: string): Set<string> => retrieved.get(sessionId) ?? new Set()

/** Chunk ids look like `bk_<hex>-s<n>[-p<n>]-c<n>`. */
export const CITATION_RE = /\[(bk_[A-Za-z0-9]+-s\d+(?:-p\d+)?-c\d+)\]/g
export const extractCitedChunkIds = (text: string): string[] => [...new Set([...text.matchAll(CITATION_RE)].map((m) => m[1]!))]
