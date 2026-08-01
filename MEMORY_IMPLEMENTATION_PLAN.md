# Memory System Implementation Plan

## Package: `@diveeoi/memory`

### Core Philosophy
- **Zettelkasten-style** knowledge graph with Obsidian-style `[[wikilinks]]`
- **No embeddings, no vector DB** - pure graph traversal with smart scoring
- **SQLite** for metadata indexing only
- **Markdown files** as source of truth (human-editable)
- **Session-bound** memory that auto-loads in sessions

---

## Phase 1: Foundation (Schema, Types, Config)

### Files
1. `packages/memory/src/schema.ts` - Types, schemas, constants
2. `packages/memory/src/config.ts` - Config schema + defaults
3. `packages/memory/package.json` - Package config
4. `packages/memory/tsconfig.json` - TypeScript config

### Types
```typescript
type MemoryType = "preference" | "decision" | "pattern" | "entity" | "error" | "fact" | "constraint" | "session"
type LinkType = "references" | "see_also" | "contradicts" | "supersedes"

interface MemoryNode {
  id: string
  type: MemoryType
  title: string
  content: string
  tags: string[]
  sessionId: string
  created: number
  updated: number
  confidence: number
  path: string
}

interface MemoryLink {
  sourceId: string
  targetId: string
  type: LinkType
  created: number
}

interface RecallOptions {
  seedNodes: string[]
  maxDepth: number
  maxNodes: number
  types?: MemoryType[]
  minConfidence?: number
}

interface RecallResult {
  nodes: MemoryNode[]
  edges: MemoryLink[]
  scores: Record<string, number>
}
```

---

## Phase 2: Storage Layer (Node + Indexer)

### Files
1. `packages/memory/src/node.ts` - Markdown parsing, frontmatter, file I/O
2. `packages/memory/src/indexer.ts` - SQLite schema, CRUD, link management

### Node Operations
- Parse/generate markdown with YAML frontmatter
- Extract `[[wikilinks]]` from content
- Atomic file writes with index sync

### SQLite Schema
```sql
-- nodes metadata
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  session_id TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  confidence REAL DEFAULT 1.0,
  tags TEXT,  -- JSON
  path TEXT NOT NULL
);

-- graph edges
CREATE TABLE links (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_type TEXT DEFAULT 'references',
  created INTEGER NOT NULL,
  PRIMARY KEY (source_id, target_id)
);

-- indexes
CREATE INDEX idx_links_target ON links(target_id);
CREATE INDEX idx_nodes_session ON nodes(session_id);
CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_updated ON nodes(updated DESC);

-- session mapping
CREATE TABLE session_memories (
  session_id TEXT PRIMARY KEY,
  root_node_id TEXT NOT NULL
);
```

---

## Phase 3: Graph Layer (Traversal, Scoring, Backlinks)

### Files
1. `packages/memory/src/graph.ts` - Graph algorithms, traversal, scoring

### Recall Algorithm
```typescript
function scoreNode(node: Node, context: RecallContext): number {
  // Recency (exp decay, 30-day half-life)
  // Link density (hub boost)
  // Type weight (decision > pattern > error > entity > preference > fact > constraint > session)
  // Confidence
  // Session relevance boost
  // Tag overlap
}

function recall(options: RecallOptions): Effect<RecallResult> {
  // BFS from seeds up to maxDepth
  // Collect nodes, score, sort, take top-N
  // Return subgraph with edges
}
```

---

## Phase 4: Memory Service (Main API)

### Files
1. `packages/memory/src/memory.ts` - Main Memory.Service

### API
```typescript
interface MemoryService {
  // Node CRUD
  createNode(input: CreateNodeInput): Effect<Node>
  getNode(id: string): Effect<Option<Node>>
  updateNode(id: string, patch: PatchNode): Effect<Node>
  deleteNode(id: string): Effect<void>
  
  // Links
  addLink(source: string, target: string, type?: LinkType): Effect<void>
  removeLink(source: string, target: string): Effect<void>
  getBacklinks(nodeId: string): Effect<Node[]>
  
  // Recall
  recall(options: RecallOptions): Effect<RecallResult>
  
  // Session
  getSessionMemory(sessionId: string): Effect<SessionMemory>
  bindSessionMemory(sessionId: string, rootNodeId: string): Effect<void>
  
  // Extraction
  extractFromSession(sessionId: string, messages: Message[]): Effect<Node[]>
}
```

---

## Phase 5: Session Integration & Extraction

### Files
1. `packages/memory/src/session.ts` - Session binding, auto-load
2. `packages/memory/src/extractor.ts` - LLM-based session extraction

### Session Binding
- On session start: load session's root node + connected graph (depth 2, max 20 nodes)
- On session end: trigger extraction (async, non-blocking)

### Extraction Prompt
```
Extract memories from this session. For each memory, output:
- type: preference|decision|pattern|entity|error|fact|constraint
- title: one-line summary
- content: full details
- tags: relevant tags
- confidence: 0-1
- links: [[wikilinks]] to existing memories (by title/id)
```

---

## Phase 6: Background Consolidation (Dreaming)

### Files
1. `packages/memory/src/consolidation.ts` - Background job

### Process
- Trigger: after session end, or token threshold
- Load session nodes + existing related nodes
- LLM: deduplicate, merge, update confidence, add links
- Write updated markdown + sync index

---

## Phase 7: Server Integration

### Files to Modify
1. `packages/server/src/session/prompt.ts` - Inject memory at session start
2. `packages/server/src/session/prompt.ts` - Extract memory at session end
3. `packages/server/src/session/memory-integration.ts` - New integration layer

### Injection Point
```typescript
// In runLoop or prompt()
const memory = yield* Memory.Service
const sessionMemory = yield* memory.getSessionMemory(sessionId)
// Inject into system prompt as context
```

---

## Implementation Order with Subagents

### Batch 1: Foundation (parallel)
- [x] Schema + Config + Package setup
- [x] Node parsing (markdown + frontmatter + wikilinks)
- [x] SQLite Indexer (schema + CRUD)

### Batch 2: Core (parallel)
- [x] Graph algorithms (traversal, scoring, backlinks)
- [x] Memory Service (main API wiring)

### Batch 3: Integration (sequential)
- [x] Session binding + auto-load
- [x] LLM Extractor
- [x] Background consolidation

### Batch 4: Server Integration
- [ ] Server memory integration layer
- [ ] Hook into session start/end

---

## Config Defaults

```typescript
const defaultConfig = {
  memoryDir: ".divee/memory",
  recall: {
    maxDepth: 2,
    maxNodes: 20,
    minConfidence: 0.3,
    typeWeights: {
      decision: 1.0,
      pattern: 0.9,
      error: 0.8,
      entity: 0.7,
      preference: 0.6,
      fact: 0.5,
      constraint: 0.5,
      session: 0.4
    }
  },
  session: {
    autoLoadDepth: 2,
    autoLoadMaxNodes: 15,
    extractOnEnd: true
  },
  consolidation: {
    enabled: true,
    triggerTokens: 10000,
    batchSize: 50
  }
}
```

---

## Testing Strategy

| Component | Tests |
|-----------|-------|
| Node parsing | Frontmatter, wikilink extraction, serialization |
| Indexer | CRUD, link management, index sync |
| Graph | BFS traversal, scoring, backlinks |
| Recall | Seed expansion, depth limiting, scoring |
| Extractor | LLM output parsing, dedup |
| Integration | Session load/inject, extraction trigger |

---

## Dependencies

- `@diveeoi/db` - SQLite, Effect, Schema
- `@diveeoi/llm` - LLM for extraction
- `yaml` - Frontmatter parsing
- `fs/promises` - File I/O

---

## Phase 8: Effect v4 Beta.74 Compatibility Fixes (COMPLETED)

### Files Fixed
1. `packages/memory/tsconfig.json` - Aligned to repo convention
2. `packages/memory/package.json` - Fixed test script
3. `packages/memory/src/indexer.ts` - Full rewrite with error mapping
4. `packages/memory/src/memory.ts` - Import fixes, brand casts, PartitionedSemaphore
5. `packages/memory/src/node.ts` - Missing imports, Effect.tryPromise fixes
6. `packages/memory/src/graph.ts` - Interface error channels, readonly array fix
7. `packages/memory/src/recall.ts` - Interface error channels, SessionID brand
8. `packages/memory/src/session.ts` - catchAll→catch, forkDaemon→forkScoped, SessionID
9. `packages/memory/src/consolidation.ts` - Interface error channels, batchSize removal
10. `packages/memory/src/extractor.ts` - Schema predicates, LLM.request pattern

### Key API Fixes (Effect v4 beta.74)
| Old API | New API |
|---------|---------|
| `Effect.catchAll` | `Effect.catch` |
| `Effect.forkDaemon` | `Effect.forkScoped` |
| `Effect.forEach(..., { batchSize })` | `Effect.forEach(..., { concurrency })` |
| `PartitionedSemaphore.make(n)` | `yield* PartitionedSemaphore.make({ permits: n })` |
| `Schema.isMaxLength` / `Schema.isMaxSize` | Use inline check functions (beta.74 types changed) |
| `Schema.optional` | `Schema.OptionFromNullOr` |

### Drizzle Adapter Fixes
- Raw SQL with `?` placeholders **silently drops params** — must use `sql` template literals
- `db.transaction` expects callback `() => Effect`, not bare Effect
- `Database.Service` yields `{ db }` — must destructure
- `db.get<T>()` supports generic for typed results

### TypeScript Config (Memory Package)
```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext"],
    "types": ["bun"],
    "noUncheckedIndexedAccess": false,
    "verbatimModuleSyntax": true
  }
}
```

### LLM Client Pattern (Extractor)
```typescript
const request = LLM.request({
  system: EXTRACTION_SYSTEM_PROMPT,
  prompt,
  generation: { temperature: 0.1, maxTokens: 2000 }
})
const response = yield* llmClient.generate(request).pipe(
  Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.fail(new Error("LLM timeout")) }),
  Effect.mapError((err) => new MemoryError(err))
)
const parsed = JSON.parse(response.text)
```

### Verification
- ✅ `bun run typecheck` — clean (0 errors)
- ✅ `bun test` — 1 pass / 0 fail

---

## Phase 9: Server Integration (NEXT)

### Required
1. Compose `MemoryLayer` in server's layer graph with:
   - `Database.defaultLayer`
   - `LLMClient.layer` (with routed model + API keys)
   - `RequestExecutor.defaultLayer`
2. Add `MemoryConfig` to server config (memory dir, consolidation, recall params)
3. Call `indexer.initialize()` at startup
4. Hook into session start: `memory.getSessionMemory(sessionId)` → inject into prompt
5. Hook into session end: `memory.extractFromSession(sessionId, messages)` (fire-and-forget)