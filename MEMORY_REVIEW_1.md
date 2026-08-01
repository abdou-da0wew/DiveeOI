# Memory Package Code Review - Algorithmic & Correctness

## graph.ts

### CRITICAL: Priority Queue Sorting is O(n log n) per push
**File:** graph.ts:180-185
```typescript
pq.push({ score: -estimatedScore, id, depth, path })
pq.sort((a, b) => a.score - b.score)
```
**Issue:** Sorting entire array on every push = O(n log n) per insertion. With 1000+ nodes this becomes O(n² log n).
**Fix:** Use a proper binary heap or `PriorityQueue` implementation.

### CRITICAL: Estimated Score Heuristic is Broken
**File:** graph.ts:173-175
```typescript
const tryPush = (id, depth, path, estimatedScore) => {
```
The `estimatedScore` passed is the parent's estimated score, not the child's. Children inherit parent's score estimate, which is wrong for a priority queue.
**Fix:** Compute actual heuristic for each neighbor (e.g., parent score * edge weight).

### HIGH: bestDepth Map Not Updated on Re-visit
**File:** graph.ts:168-170
```typescript
const currentBestDepth = bestDepth.get(id)
if (currentBestDepth !== undefined && depth >= currentBestDepth) return
bestDepth.set(id, depth)
```
If a node is first reached at depth 3, then later at depth 1, the depth 1 path will be rejected because `bestDepth` already has 3.
**Fix:** Update `bestDepth` when a shorter path is found: `if (currentBestDepth === undefined || depth < currentBestDepth) bestDepth.set(id, depth)`

### HIGH: Depth Penalty Uses Config Lambda But Formula is Different
**File:** graph.ts:105
```typescript
const depthPenalty = 1 - Math.exp(-depth * config.recall.depthPenaltyLambda)
```
But `scoreNode` uses this same formula. The `depthPenaltyLambda` in config is 0.15, but the old formula used 0.5. The new formula gives much weaker penalty.
**Fix:** Verify intended penalty curve. At depth 3: old=0.78, new=0.36. May need lambda=0.4 for similar behavior.

### MEDIUM: PQ Entry Includes Full Path (Memory Leak)
**File:** graph.ts:147
```typescript
path: [...path, link.targetId]
```
Stores full path for every PQ entry. At depth 5 with 1000 nodes, this is O(n²) memory.
**Fix:** Store parent pointer only, reconstruct path when needed.

---

## indexer.ts

### CRITICAL: N+1 Query Pattern in getSessionNodes
**File:** indexer.ts:252-289
```typescript
const getSessionNodes = (sessionId: string) =>
  Effect.gen(function* () {
    const rootId = yield* getSessionRoot(sessionId)
    // ... BFS loop ...
    while (queue.length > 0) {
      const node = yield* getNode(id)  // N queries!
      const links = yield* getLinks(id)  // N queries!
      const backlinks = yield* getBacklinks(id)  // N queries!
    }
  })
```
**Issue:** 3 queries per node visited. At 20 nodes = 60 round-trips.
**Fix:** Single query with recursive CTE or batch fetch.

### HIGH: No Transaction for Multi-Table Writes
**File:** indexer.ts:43-50 (upsertNode), 53-58 (deleteNode)
```typescript
yield* db.run(`INSERT OR REPLACE INTO memory_nodes ...`)
yield* db.run(`DELETE FROM memory_links WHERE ...`)
```
If second query fails, first succeeds = orphaned data.
**Fix:** Wrap in `db.transaction()` or use `Effect.all` with proper error handling.

### HIGH: content Column Exists But Never Populated
**File:** indexer.ts:128, 173
```typescript
content: "",  // rowToNode ignores content column
```
SQLite schema has `content` column but indexer never stores it. SearchNodes queries `LOWER(content) LIKE ?` which will always match nothing.
**Fix:** Either remove column or populate it from node content.

### MEDIUM: SearchNodes Uses LIKE on Unindexed Columns
**File:** indexer.ts:220-230
```typescript
WHERE LOWER(title) LIKE ? OR LOWER(content) LIKE ?
```
No index on `LOWER(title)` or `content`. Full table scan.
**Fix:** Add GIN index or use FTS5 virtual table.

---

## memory.ts

### CRITICAL: extractFromMessages Uses Hardcoded Model
**File:** memory.ts:285-290
```typescript
const response = yield* llm.generate({
  model: "openai-compatible:gpt-4o-mini",
  ...
})
```
**Issue:** Hardcoded model string. Won't work if provider doesn't have this model.
**Fix:** Use `LLMClient.prepare` with a configured extraction model from config.

### HIGH: Race Condition in updateNode Wikilink Processing
**File:** memory.ts:103-115
```typescript
const oldLinks = yield* indexer.getLinks(id)
for (const link of oldLinks) yield* indexer.deleteLink(id, link.targetId)
const linkIds = yield* nodeService.extractWikilinks(node.content)
for (const linkId of linkIds) yield* indexer.upsertLink(node.id, linkId, "references")
```
**Issue:** Between delete and insert, another request could read empty links. Not atomic.
**Fix:** Compute diff (added/removed) and apply in single transaction.

### HIGH: getSessionMemory Creates Root Node on Every Miss
**File:** memory.ts:180-192
```typescript
const rootNodeId = yield* indexer.getSessionRoot(sessionId)
if (Option.isNone(rootNodeId)) {
  const rootNode = yield* createSessionRoot(sessionId, "Untitled")
  return SessionMemory.make(...)
}
```
**Issue:** Creates new root node on every call for missing session. If called concurrently, creates multiple roots.
**Fix:** Use `indexer.bindSession` with `INSERT OR IGNORE` or check-then-act in transaction.

### MEDIUM: getStats Uses Raw SQL for Session Count
**File:** memory.ts:340-350
```typescript
const sessionCount = yield* Effect.tryPromise({
  try: () => db.get(`SELECT COUNT(*) as count FROM session_memories`),
  catch: () => ({ count: 0 })
})
```
**Issue:** Bypasses indexer, inconsistent with rest of service.
**Fix:** Add `countSessions` to indexer service.

---

## extractor.ts

### CRITICAL: LLM Prompt Injection Vulnerability
**File:** extractor.ts:65-85
```typescript
const prompt = `${EXTRACTION_SYSTEM_PROMPT}

EXISTING MEMORIES (for linking):
${existingTitles || "(none)"}

CONVERSATION TO ANALYZE:
${relevantMessages}

Extract memories as JSON array:`
```
**Issue:** `relevantMessages` and `existingTitles` are directly interpolated. User messages could contain `JSON array:` or other injection patterns.
**Fix:** Use structured prompt with clear delimiters, escape content, or use LLM tool calling.

### HIGH: JSON Parsing Has No Schema Validation
**File:** extractor.ts:94-130
```typescript
const extracted = JSON.parse(response.content)
for (const item of extracted) {
  if (!item.type || !item.title || !item.content) continue
  // ... assumes structure
}
```
**Issue:** No schema validation. Malformed LLM output crashes extraction or creates garbage nodes.
**Fix:** Use `Schema.decodeUnknownSync(Schema.Array(ExtractedMemory))` with proper error handling.

### HIGH: Link Resolution Ignores Link Type
**File:** extractor.ts:100-115
```typescript
const linkType = (link[1] as LinkType) || "references"
```
**Issue:** Only uses type for indexer. The extractor prompt asks for links but doesn't enforce valid types in schema.
**Fix:** Add `LinkType` to `ExtractedMemory` schema and validate.

### MEDIUM: extractFromSession Creates Nodes Without Path
**File:** extractor.ts:160-175
```typescript
const node: MemoryNode = {
  ...
  path: "" // Will be set by node service
}
```
**Issue:** Creates invalid `MemoryNode` (path required by schema). Node service will fail on `serializeNode`.
**Fix:** Generate proper path or make path optional in schema.

---

## consolidation.ts

### CRITICAL: Data Loss in mergeNodes
**File:** consolidation.ts:180-210
```typescript
if (!mergedContent.includes(dup.value.content)) {
  mergedContent += "\n\n---\n\n" + dup.value.content
}
```
**Issue:** String `includes` check is unreliable. "Error handling" includes "Error" but they're different concepts. Duplicate detection merges semantically different nodes.
**Fix:** Use semantic similarity (embeddings or LLM) not string inclusion.

### CRITICAL: mergeNodes Deletes Duplicates Without Transaction
**File:** consolidation.ts:200-210
```typescript
yield* indexer.deleteLink(link.sourceId, dup.value.id)
yield* indexer.upsertLink(link.sourceId, primaryId, link.type)
yield* memory.deleteNode(dup.value.id)
```
**Issue:** If process crashes after deleting links but before updating primary, data is lost.
**Fix:** Wrap in transaction or implement idempotent operations with compensation.

### HIGH: Duplicate Detection O(n²) with String Similarity
**File:** consolidation.ts:145-175
```typescript
for (const node of allNodes) {
  for (const other of allNodes) {  // O(n²)
    const similarity = calculateSimilarity(node, other)
  }
}
```
**Issue:** At 1000 nodes = 1M comparisons. `calculateSimilarity` uses string splitting.
**Fix:** Use locality-sensitive hashing or restrict to recent nodes + same type.

### HIGH: findDuplicates Called Multiple Times with Different Thresholds
**File:** consolidation.ts:260-264
```typescript
const duplicates = yield* findDuplicates(undefined, 0.9)
for (const group of duplicates) yield* mergeNodes(...)
const recent = yield* indexer.getRecentNodes(100)
for (const node of recent) yield* strengthenConnections(node.id)
```
**Issue:** `findDuplicates` does full scan at 0.85, then again at 0.9. Wasted work.
**Fix:** Single pass with configurable thresholds, or cache results.

---

## schema.ts

### HIGH: Error Classes Not Serializable
**File:** schema.ts:160-175
```typescript
export class MemoryError extends Error {
  readonly _tag = "MemoryError"
  constructor(override readonly cause: unknown) { super(String(cause)) }
}
```
**Issue:** `cause: unknown` not serializable. Can't be sent over RPC or logged properly.
**Fix:** Store `cause: string` or implement custom serialization.

### MEDIUM: RecallOptions timeRange Optional But Not Validated
**File:** schema.ts:80-85
```typescript
timeRange: optionalOmitUndefined(Schema.Struct({
  from: Schema.Number,
  to: Schema.Number
}))
```
**Issue:** No validation that `from <= to` or that values are valid timestamps.
**Fix:** Add refinement: `Schema.filter(({ from, to }) => from <= to)`.
