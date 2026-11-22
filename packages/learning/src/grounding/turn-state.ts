// packages/learning/src/grounding/turn-state.ts
//
// Which passages the model was actually shown recently (retrieved context plus anything its
// tools read), tracked as a bounded window of recent turns. The verifier (plan §9.6) accepts
// citations of passages in this set.
//
// #9/#15: the verifier previously compared citations against a single flat set that was reset
// at the start of every turn, so legitimately citing a passage retrieved in an earlier turn
// (still present in the conversation) produced a false "not shown to the model this turn"
// warning. The set is now a sliding window over the last CITATION_TURN_WINDOW turns: starting
// a turn pushes a fresh set instead of wiping history.
//
// Entries are process-local, short-lived, and bounded so abandoned sessions cannot leak memory.

const MAX_TRACKED_SESSIONS = 2_048
const MAX_CHUNKS_PER_SESSION = 20_000
const SESSION_TTL_MS = 30 * 60 * 1_000

/** How many recent turns a citation may reference before "not shown" is reported again. */
export const CITATION_TURN_WINDOW = 10

interface SessionEntry {
  /** Chronological turn sets; the last one is the current turn. */
  turns: Set<string>[]
  touchedAt: number
}

const retrieved = new Map<string, SessionEntry>()

const totalChunks = (entry: SessionEntry) => {
  let total = 0
  for (const turn of entry.turns) total += turn.size
  return total
}

/** Drop the oldest tracked chunk id across the window (insertion order = oldest first). */
const evictOldestChunk = (entry: SessionEntry) => {
  for (const turn of entry.turns) {
    for (const id of turn) {
      turn.delete(id)
      return
    }
  }
}

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

const touch = (sessionId: string, entry: SessionEntry, now: number) => {
  entry.touchedAt = now
  retrieved.delete(sessionId)
  retrieved.set(sessionId, entry)
  prune(now)
}

/**
 * Start a new turn: push a fresh chunk set and trim the window to the last
 * CITATION_TURN_WINDOW turns, keeping earlier turns verifiable (#9/#15).
 */
export const resetRetrieved = (sessionId: string) => {
  const now = Date.now()
  const entry = retrieved.get(sessionId) ?? { turns: [], touchedAt: now }
  entry.turns.push(new Set())
  if (entry.turns.length > CITATION_TURN_WINDOW) {
    entry.turns.splice(0, entry.turns.length - CITATION_TURN_WINDOW)
  }
  touch(sessionId, entry, now)
}

export const recordRetrieved = (sessionId: string, chunkIds: Iterable<string>) => {
  const now = Date.now()
  const entry = retrieved.get(sessionId) ?? { turns: [], touchedAt: now }
  if (entry.turns.length === 0) entry.turns.push(new Set())
  const current = entry.turns[entry.turns.length - 1]!
  for (const id of chunkIds) {
    if (!id) continue
    if (!current.has(id) && totalChunks(entry) >= MAX_CHUNKS_PER_SESSION) {
      evictOldestChunk(entry)
    }
    current.add(id)
  }
  touch(sessionId, entry, now)
}

/** Union of the chunk ids shown to the model across the recent-turns window. */
export const getRetrieved = (sessionId: string): Set<string> => {
  const now = Date.now()
  const entry = retrieved.get(sessionId)
  if (!entry || now - entry.touchedAt > SESSION_TTL_MS) {
    retrieved.delete(sessionId)
    return new Set()
  }
  touch(sessionId, entry, now)
  const union = new Set<string>()
  for (const turn of entry.turns) {
    for (const id of turn) union.add(id)
  }
  return union
}

export const clearRetrieved = (sessionId: string) => retrieved.delete(sessionId)

/** Chunk ids look like `bk_<hex>-s<n>[-p<n>]-c<n>`. */
export const CITATION_RE = /\[(bk_[A-Za-z0-9]+-s\d+(?:-p\d+)?-c\d+)\]/g
export const extractCitedChunkIds = (text: string): string[] => [...new Set([...text.matchAll(CITATION_RE)].map((match) => match[1]!))]
