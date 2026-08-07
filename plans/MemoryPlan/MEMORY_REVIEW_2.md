# Memory Package Architecture Review

## index.ts - Layer Composition

### CRITICAL: Circular Dependency Risk in Layer Graph
**File:** index.ts:17-32
```typescript
export const MemoryLayer = Layer.mergeAll(
  MemoryConfig.defaultLayer,
  NodeFileSystem.layer,
  Path.defaultLayer,
  Database.defaultLayer,
  LLMClient.defaultLayer,
  IndexerLive,      // needs Database
  NodeLive,         // needs Indexer, MemoryConfig
  GraphLive,        // needs Indexer, MemoryConfig
  ExtractorLive,    // needs LLMClient, Indexer, MemoryConfig
  SessionLive,      // needs MemoryService
  RecallLive,       // needs GraphService, MemoryConfig
  ConsolidationLive,// needs MemoryService, Indexer, MemoryConfig
  MemoryLive        // needs NodeService, Indexer, GraphService, MemoryConfig, Database, LLMClient
).pipe(Layer.provide(MemoryConfig.defaultLayer))
```
**Issue:** `MemoryLive` provides `MemoryService` which is required by `SessionLive` and `ConsolidationLive`, but those are merged BEFORE `MemoryLive`. Effect layers are evaluated in order - services must be provided before consumed.
**Fix:** Reorder: `MemoryLive` first, then dependents. Or use `Layer.provide` chains.

### CRITICAL: Missing Effect-TS Error Boundaries
**File:** index.ts:17-32
No `Layer.provideMerge` or error handling for partial layer failures. If `Database.defaultLayer` fails, all downstream layers fail silently.
**Fix:** Add `Layer.catchAll` or use `Layer.provideMerge` with explicit error types.

### HIGH: TestMemoryLayer = MemoryLayer (No Mocking)
**File:** index.ts:51
```typescript
export const TestMemoryLayer = MemoryLayer
```
**Issue:** Tests use real SQLite, real LLM, real filesystem. No mocking for unit tests.
**Fix:** Create `TestMemoryLayer` with in-memory SQLite, mock LLM, temp filesystem.

### HIGH: LLMClient.defaultLayer Not Exported Properly
**File:** index.ts:20
```typescript
LLMClient.defaultLayer
```
**Issue:** `LLMClient` from `@diveeoi/llm` - need to verify it exports `defaultLayer`. If not, layer construction fails at runtime.
**Fix:** Verify import or provide explicit layer.

---

## node.ts - FileSystem Coupling

### CRITICAL: Direct NodeJS fs/promises Usage
**File:** node.ts:5-6, 85-95
```typescript
import * as fs from "node:fs/promises"
import * as path from "node:path"
```
**Issue:** Bypasses Effect `FileSystem` service. Can't mock for tests, breaks portability (Windows paths), no Effect error handling.
**Fix:** Use `yield* FileSystem` and `yield* Path` from Effect platform.

### HIGH: parseMarkdownNode Uses JSON.parse for Frontmatter
**File:** node.ts:23-25
```typescript
const frontmatter = JSON.parse(frontmatterStr) as Record<string, unknown>
```
**Issue:** Frontmatter is YAML, not JSON. Fails on valid YAML like `tags: [a, b]` (no quotes).
**Fix:** Use `yaml` package already in deps: `parse(frontmatterStr)`.

### HIGH: generateNodeId Uses Math.random (Collision Risk)
**File:** node.ts:58
```typescript
export const generateNodeId = (): MemoryNodeID => `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` as MemoryNodeID
```
**Issue:** `Math.random()` not cryptographically secure. Collisions possible under load.
**Fix:** Use `crypto.randomUUID()` or `crypto.randomBytes()`.

### MEDIUM: NodeService Leaks Implementation Details
**File:** node.ts:250-270
```typescript
export const NodeServiceLive = Layer.effect(NodeService, Effect.gen(function* () {
  const config = yield* MemoryConfig
  const indexer = yield* IndexerService
  // returns object with create, get, update, delete, list, readFile, writeFile
}))
```
**Issue:** Service exposes `readFile`/`writeFile` which are implementation details. Consumers should use `create`/`get`/`update`/`delete`.
**Fix:** Remove `readFile`/`writeFile` from public interface.

---

## session.ts - Prompt Injection & Memory Lifecycle

### CRITICAL: injectMemoryIntoPrompt String Concatenation
**File:** session.ts:55-85
```typescript
const injectionPoint = basePrompt.indexOf("\n\nUser:")
if (injectionPoint >= 0) {
  return basePrompt.slice(0, injectionPoint) + memoryBlock + basePrompt.slice(injectionPoint)
}
return basePrompt + memoryBlock
```
**Issue:** String manipulation on prompts is fragile. Fails if prompt format changes. No token budget awareness.
**Fix:** Use structured prompt template with explicit memory slot.

### HIGH: extractOnSessionEnd Uses forkDaemon (Fire-and-Forget)
**File:** session.ts:90-100
```typescript
yield* memory.extractFromSession(sessionId, messages).pipe(
  Effect.catchAll(err => Effect.logError(...)),
  Effect.forkDaemon
)
```
**Issue:** Extraction runs in background with no tracking. If LLM fails, no retry. If process exits, extraction dies silently.
**Fix:** Use `Effect.forkIn(scope)` with proper supervision, or queue to background job system.

### HIGH: Session Memory Not Isolated Per User
**File:** session.ts:35-50
```typescript
const initializeSession = (sessionId: string, title: string) =>
  Effect.gen(function* () {
    const existing = yield* memory.getSessionMemory(sessionId).pipe(...)
  })
```
**Issue:** `sessionId` is the only isolation key. No user/project scoping. Multi-tenant data leakage risk.
**Fix:** Add `userId`/`projectId` to session memory key.

### MEDIUM: No Memory Budget / Token Limit Enforcement
**File:** session.ts:55-85
```typescript
const memoryBlock = `\n\n<memory-context>\n${memorySections}\n</memory-context>\n`
```
**Issue:** Injects ALL recalled memories without token counting. Can exceed model context window.
**Fix:** Add token estimation, truncate to budget, prioritize by score.

---

## config.ts - Schema Validation

### HIGH: No Validation on Schema Fields
**File:** config.ts:6-11
```typescript
export class RecallConfig extends Schema.Class<RecallConfig>("RecallConfig")({
  maxDepth: Schema.Int,
  maxNodes: Schema.Int,
  minConfidence: Schema.Number,
  typeWeights: Schema.Record(Schema.String, Schema.Number),
  depthPenaltyLambda: Schema.Number
}) {}
```
**Issue:** No constraints. `maxDepth: -5` or `minConfidence: 5.0` or `depthPenaltyLambda: -1` all valid.
**Fix:** Add refinements: `Schema.Int.pipe(Schema.between(1, 10))`, `Schema.Number.pipe(Schema.between(0, 1))`.

### MEDIUM: defaultMemoryConfig Not Frozen
**File:** config.ts:36-63
```typescript
export const defaultMemoryConfig = MemoryConfig.make({ ... })
```
**Issue:** Object is mutable. Accidental modification affects all layers.
**Fix:** Use `Object.freeze()` or make it a `Layer.succeed` constant.

---

## memory.ts - Service Orchestration

### CRITICAL: MemoryService Exposes Internal Services
**File:** memory.ts:40-50
```typescript
export interface MemoryService {
  ...
  readonly indexer: IndexerService
  readonly graph: GraphService
  readonly node: NodeService
}
```
**Issue:** Leaks implementation details. Consumers can bypass MemoryService logic by calling indexer/graph directly.
**Fix:** Hide internal services. Only expose high-level operations.

### HIGH: No Retry/Circuit Breaker for LLM Calls
**File:** memory.ts:285-320
```typescript
const response = yield* llm.generate({ ... }).pipe(
  Effect.catchAll((err) => { console.error(...); return Effect.succeed({ content: "[]" }) })
)
```
**Issue:** Single attempt, no retry, no circuit breaker. LLM failures silently return empty array.
**Fix:** Add `Schedule.exponential` retry, `CircuitBreaker` wrapper.

### HIGH: consolidate() Silently Swallows Errors
**File:** memory.ts:325-350
```typescript
const consolidate = (sessionId: string) =>
  Effect.gen(function* () {
    if (!config.consolidation.enabled) return
    // ... no error handling
  })
```
**Issue:** If consolidation fails, no logging, no retry, no alert. Data quality degrades silently.
**Fix:** Add error handling, metrics, alerting.

### MEDIUM: extractFromMessages Creates Nodes with Empty Path
**File:** memory.ts:350-370
```typescript
const node = yield* createNode({
  type: ex.type,
  ...
  links: ex.links  // links reference targetId but path is ""
})
```
**Issue:** Created nodes have `path: ""` which fails serialization.
**Fix:** Generate path in `createNode` or make path optional in schema.
