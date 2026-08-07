# Plan: Wire @diveeoi/memory into Main Server

## Overview
Integrate the memory system into the DiveeOI server so it:
1. Initializes on server startup
2. Runs per-session memory context injection
3. Runs daily consolidation at "sleep time" (nightly cron)
4. Provides agent tools for manual memory management

---

## Architecture Integration Points

### 1. Layer Composition (serverLayer)
**File:** `packages/server/src/server/routes/instance/httpapi/server.ts`
- Add `Memory.node` to `LayerNode.group([...])` (line 207-263)
- This provides: `MemoryService`, `IndexerService`, `GraphService`, `RecallService`, `SessionService`, `ExtractorService`, `ConsolidationService`, `MemoryConfig`

### 2. Session Initialization Hook
**File:** `packages/server/src/session/session.ts` or new `packages/server/src/session/memory.ts`
- On session creation/load: call `MemoryService.initializeSession(sessionId, title)`
- On session end: call `MemoryService.extractOnSessionEnd(sessionId, messages)`
- Hook into `SessionProcessor` or `SessionRunState` for message access

### 3. Memory Context Injection
**File:** `packages/server/src/session/prompt.ts` or `packages/server/src/session/llm.ts`
- Before each LLM request: call `MemoryService.loadSessionContext(sessionId)`
- Inject returned memory block into system prompt

### 4. Daily Consolidation (Sleep Time)
**File:** New `packages/server/src/background/memory-consolidation.ts`
- Use `BackgroundJob` service with cron schedule
- Run at 3 AM daily (configurable)
- For each active session: `MemoryService.consolidate(sessionId)`
- Log results, handle errors gracefully

### 5. Agent Tools for Memory Management
**Files:** New `packages/server/src/tool/memory/*.ts` + register in `packages/server/src/tool/registry.ts`

---

## Tool Specifications

| Tool | Purpose | Safety |
|------|---------|--------|
| `memory_retrieve` | Search/recall memories with filters | Read-only, no mutations |
| `memory_create` | Create new memory node | Validates input, deduplicates |
| `memory_update` | Update existing memory (content, tags, confidence) | Optimistic locking via version |
| `memory_delete` | Delete memory node + edges | Soft delete option, confirmation |
| `memory_link` | Add/remove links between nodes | Validates link types, prevents cycles |
| `memory_consolidate` | Trigger consolidation for current session | Idempotent, rate-limited |
| `memory_stats` | Show memory graph statistics | Read-only |
| `memory_enable` / `memory_disable` | Toggle memory for session/project | Persists to config |

---

## Implementation Order

### Phase 1: Core Layer Integration
1. Add `Memory.node` to server layer group
2. Verify typecheck passes
3. Test server boots with memory layer

### Phase 2: Session Hooks
1. Create `SessionMemoryService` in `packages/server/src/session/memory.ts`
2. Hook `initializeSession` on session create/load
3. Hook `extractOnSessionEnd` on session end
4. Add memory context injection to prompt building

### Phase 3: Daily Consolidation Job
1. Create `MemoryConsolidationJob` using `BackgroundJob`
2. Schedule via cron (3 AM daily)
3. Iterate sessions, call `consolidate`
4. Add config for schedule/timezone

### Phase 4: Agent Tools
1. Create tool files in `packages/server/src/tool/memory/`
2. Register in `ToolRegistry` (registry.ts)
3. Add proper schemas, validation, error handling
4. Test each tool end-to-end

### Phase 5: Config & Polish
1. Add memory config to server config (enable/disable, schedule, paths)
2. Update API routes if needed for tool exposure
3. Integration tests

---

## Key Technical Details

### Memory Layer Node (in memory package)
```typescript
// packages/memory/src/index.ts - already exports MemoryLayer
export const MemoryLayer = LayerNode.buildLayer(
  LayerNode.group([memory, session, recall, consolidation, extractor, indexer, graph, node])
)
```

### Server Layer Integration
```typescript
// In server.ts LayerNode.group([...]):
Memory.node,  // Add this line
```

### Session Memory Hook
```typescript
// In session processor or run-state:
const memory = yield* MemoryService
yield* memory.initializeSession(sessionId, title)
// ... on session end:
yield* memory.extractOnSessionEnd(sessionId, messages)
```

### Prompt Injection
```typescript
// In prompt.ts or llm.ts:
const memory = yield* MemoryService
const context = yield* memory.loadSessionContext(sessionId)
// Inject context into system prompt
```

### Background Consolidation
```typescript
// New file: packages/server/src/background/memory-consolidation.ts
const consolidationJob = BackgroundJob.start({
  type: "memory-consolidation",
  title: "Daily Memory Consolidation",
  run: Effect.gen(function* () {
    const memory = yield* MemoryService
    const sessions = yield* getActiveSessions()
    for (const session of sessions) {
      yield* memory.consolidate(session.id)
    }
    return `Consolidated ${sessions.length} sessions`
  })
})
// Schedule via cron in server startup
```

### Tool Pattern (following existing tools)
```typescript
// packages/server/src/tool/memory/retrieve.ts
export const MemoryRetrieveTool = Tool.make("memory_retrieve", {
  description: "Search and retrieve memories from the knowledge graph",
  parameters: Schema.Struct({
    query: Schema.String,
    sessionId: Schema.optional(Schema.String),
    types: Schema.optional(Schema.Array(MemoryType)),
    limit: Schema.optional(Schema.Int.pipe(Schema.between(1, 50))),
  }),
  execute: Effect.fn("MemoryRetrieveTool.execute")(function* (args, ctx) {
    const memory = yield* MemoryService
    return yield* memory.recall({
      seedNodes: args.sessionId ? [args.sessionId as MemoryNodeID] : [],
      queryTags: args.query.split(/\s+/).filter(t => t.length > 2),
      maxNodes: args.limit ?? 20,
      types: args.types,
    })
  }),
})
```

---

## Safety & Error Handling Requirements

1. **All tools**: Wrap in `Effect.catchAll` → return structured `MemoryError` with user-friendly message
2. **Validation**: Schema validation on all inputs (Effect Schema)
3. **Rate limiting**: Per-session rate limits on mutating tools
4. **Confirmation**: Destructive operations (delete) require explicit confirmation flag
5. **Audit logging**: All tool executions logged with session, user, params
6. **Rollback**: Failed multi-step operations (link + node create) use transactions
7. **Permissions**: Check `Permission` service before allowing memory operations

---

## Config Schema (add to packages/server/src/config/config.ts)
```typescript
export const MemoryServerConfig = Schema.Struct({
  enabled: Schema.Boolean,
  sleepTime: Schema.String, // cron expression or "03:00"
  timezone: Schema.String,  // "UTC"
  maxSessionMemories: Schema.Int,
  consolidationTriggerTokens: Schema.Int,
  autoExtractOnSessionEnd: Schema.Boolean,
}).pipe(Schema.defaults({
  enabled: true,
  sleepTime: "0 3 * * *",
  timezone: "UTC",
  maxSessionMemories: 1000,
  consolidationTriggerTokens: 10000,
  autoExtractOnSessionEnd: true,
}))
```

---

## Verification Checklist

- [ ] `bun run typecheck` clean in packages/server
- [ ] Server boots with memory layer
- [ ] Session create/load triggers `initializeSession`
- [ ] Session end triggers `extractOnSessionEnd`
- [ ] Prompt injection works (memory context appears in LLM requests)
- [ ] Daily consolidation job runs at scheduled time
- [ ] All 8 tools registered and executable
- [ ] Tools handle edge cases (empty graph, missing nodes, invalid IDs)
- [ ] Tools return structured errors, not stack traces
- [ ] Integration test: create → link → retrieve → update → delete cycle
- [ ] Memory config respected (disable stops all operations)