// packages/learning/src/grounding/turn-state.ts
//
// Which passages the model was actually shown this turn (retrieved context plus anything its
// tools read). The verifier (plan §9.6) only accepts citations of passages in this set.
// Entries are process-local, short-lived, and bounded so abandoned sessions cannot leak memory.

const MAX_TRACKED_SESSIONS = 2_048
const MAX_CHUNKS_PER_SESSION = 20_000
const SESSION_TTL_MS = 30 * 60 * 1_000

interface TurnEntry {
  ids: Set<string>
  touchedAt: number
}

const retrieved = new Map<string, TurnEntry>()

const prune = (now: number) => {
  for (const [sessionId, entry] of retrieved) {
    if (now - entry.touchedAt > SESSION_TTL_MS) retrieved.delete(sessionId)
  }
  while (retrieved.size > MAX_TRACKED_SESSIONS) {
    const oldest = retrieved.keys().next().value
    if (oldest === undefined) break
    retrieved.delete(oldest)
  }
}

const touch = (sessionId: string, entry: TurnEntry, now: number) => {
  entry.touchedAt = now
  retrieved.delete(sessionId)
  retrieved.set(sessionId, entry)
  prune(now)
}

export const resetRetrieved = (sessionId: string) => {
  const now = Date.now()
  const entry: TurnEntry = { ids: new Set(), touchedAt: now }
  touch(sessionId, entry, now)
  return entry.ids
}

export const recordRetrieved = (sessionId: string, chunkIds: Iterable<string>) => {
  const now = Date.now()
  const entry = retrieved.get(sessionId) ?? { ids: new Set<string>(), touchedAt: now }
  for (const id of chunkIds) {
    if (!id) continue
    if (!entry.ids.has(id) && entry.ids.size >= MAX_CHUNKS_PER_SESSION) {
      const oldest = entry.ids.values().next().value
      if (oldest !== undefined) entry.ids.delete(oldest)
    }
    entry.ids.add(id)
  }
  touch(sessionId, entry, now)
}

export const getRetrieved = (sessionId: string): Set<string> => {
  const now = Date.now()
  const entry = retrieved.get(sessionId)
  if (!entry || now - entry.touchedAt > SESSION_TTL_MS) {
    retrieved.delete(sessionId)
    return new Set()
  }
  touch(sessionId, entry, now)
  return entry.ids
}

export const clearRetrieved = (sessionId: string) => retrieved.delete(sessionId)

/** Chunk ids look like `bk_<hex>-s<n>[-p<n>]-c<n>`. */
export const CITATION_RE = /\[(bk_[A-Za-z0-9]+-s\d+(?:-p\d+)?-c\d+)\]/g
export const extractCitedChunkIds = (text: string): string[] => [...new Set([...text.matchAll(CITATION_RE)].map((match) => match[1]!))]
