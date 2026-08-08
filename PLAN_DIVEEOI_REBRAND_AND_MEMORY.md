# DiveeOI Rebrand & Memory System Overhaul — Implementation Plan

**Author**: Gelo-4  
**Date**: 2026-08-08  
**Status**: Planning phase — review before implementation

---

## 1. Path Rebranding: `opencode` → `diveeoi`

### 1.1 Files to Modify

| File | Current | Target | Notes |
|---|---|---|---|
| `packages/db/src/global.ts` | `app = "opencode"` | `app = "diveeoi"` | **Primary** — controls all xdg paths |
| `packages/db/src/flag/flag.ts` | All `OPENCODE_*` env vars | `DIVEEOI_*` (keep `OPENCODE_*` as deprecated aliases) | Env var migration |
| `packages/db/src/config.ts` | `.opencode` config dir detection | `.diveeoi` (fallback to `.opencode`) | Project config discovery |
| `packages/memory/src/config.ts` | `memoryDir: ".divee/memory"` | Keep `.divee/memory` (already correct) | Verify |
| `packages/profiler/src/writer.ts` | `.divee/profiler.jsonl` | Keep `.divee/profiler.jsonl` | Already correct |

### 1.2 Env Var Migration Strategy

**New primary vars** (add to `flag.ts`):
```
DIVEEOI_CONFIG_DIR
DIVEEOI_DB
DIVEEOI_SERVER_PASSWORD
DIVEEOI_SERVER_USERNAME
DIVEEOI_EXPERIMENTAL
...etc (mirror all OPENCODE_*)
```

**Deprecated aliases** (keep reading `OPENCODE_*` with fallback):
```typescript
get DIVEEOI_CONFIG_DIR() {
  return process.env["DIVEEOI_CONFIG_DIR"] ?? process.env["OPENCODE_CONFIG_DIR"]
}
```

**Rationale**: Existing users with `OPENCODE_*` env vars continue working; new installs use `DIVEEOI_*`.

### 1.3 XDG Path Changes

`global.ts` lines 10-14:
```typescript
// BEFORE
const app = "opencode"
const data = path.join(xdgData!, app)      // ~/.local/share/opencode
const cache = path.join(xdgCache!, app)    // ~/.cache/opencode
const config = path.join(xdgConfig!, app)  // ~/.config/opencode
const state = path.join(xdgState!, app)    // ~/.local/state/opencode

// AFTER
const app = "diveeoi"
const data = path.join(xdgData!, app)      // ~/.local/share/diveeoi
const cache = path.join(xdgCache!, app)    // ~/.cache/diveeoi
const config = path.join(xdgConfig!, app)  // ~/.config/diveeoi
const state = path.join(xdgState!, app)    // ~/.local/state/diveeoi
```

### 1.4 Migration Logic (Critical)

**Database migration**: On first run with new paths, check if `~/.local/share/opencode/opencode.db` exists and `~/.local/share/diveeoi/diveeoi.db` does NOT. If so:
1. Copy/move the old DB to new location
2. Update any internal paths stored in DB (unlikely needed since paths are relative)

**Config migration**: Check `~/.config/opencode/` → `~/.config/diveeoi/`

**Implementation**: Add a `migrateFromOpencode()` function in `global.ts` layer initialization that runs once.

---

## 2. Memory System: Multi-Project Loading with Fallbacks

### 2.1 Current Architecture

- `MemoryConfig.memoryDir = ".divee/memory"` — relative to CWD
- `NodeService` reads/writes `.md` files in `{cwd}/.divee/memory/`
- `IndexerService` stores metadata in main SQLite (`memory_nodes`, `memory_links`, `session_memories`)
- `memory_nodes.path` column stores the **absolute path** to the `.md` file

### 2.2 Requirements

1. **Load memories from ALL projects** — not just current CWD
2. **Map memories by project** — track which project/directory each memory belongs to
3. **Fallback if path missing** — if `.md` file deleted/moved, keep metadata, mark as orphaned
4. **Auto-detect** — scan known project directories for `.divee/memory/` folders

### 2.3 Schema Changes

**`memory_nodes` table** — add columns:
```sql
ALTER TABLE memory_nodes ADD COLUMN project_id TEXT;        -- hash/ID of project root
ALTER TABLE memory_nodes ADD COLUMN project_root TEXT;      -- absolute path to project root
ALTER TABLE memory_nodes ADD COLUMN file_exists BOOLEAN DEFAULT 1;  -- fallback flag
```

**New table**: `memory_projects`
```sql
CREATE TABLE memory_projects (
  id TEXT PRIMARY KEY,           -- hash of project_root
  root_path TEXT NOT NULL UNIQUE, -- absolute path
  name TEXT,                      -- derived from path
  last_scanned INTEGER,           -- timestamp
  is_active BOOLEAN DEFAULT 1
);
```

### 2.4 Implementation Plan

#### Phase 2A: Schema Migration
- Add migration file in `packages/db/src/database/migration/`
- Add columns to `memory_nodes`, create `memory_projects` table
- Backfill existing nodes with `project_root = config.memoryDir` parent

#### Phase 2B: Project Registry Service
New service `ProjectRegistryService` (`packages/memory/src/project-registry.ts`):
- `registerProject(root: AbsolutePath): Effect<ProjectInfo>`
- `listProjects(): Effect<ProjectInfo[]>`
- `scanForMemoryDirs(): Effect<void>` — walks known project roots, finds `.divee/memory/`
- `resolveProjectForPath(filePath: AbsolutePath): Option<ProjectInfo>`

#### Phase 2C: Indexer Enhancements
- `initialize()` — also scans for projects and registers them
- `upsertNode(node)` — auto-assign `project_id`/`project_root` from `node.path`
- `verifyFileExists(nodeId): Effect<boolean>` — checks if `.md` file still exists
- `markOrphaned(nodeId): Effect<void>` — sets `file_exists = 0`
- `getOrphanedNodes(): Effect<MemoryNode[]>`

#### Phase 2D: NodeService Fallbacks
- `get(id)` — if file missing, return metadata from index with `file_exists = false`
- `createNode()` — register project if new, set `project_root`
- Add `getProjectMemories(projectId)` method

#### Phase 2E: Recall/Graph — Project Awareness
- `recall()` accepts optional `projectId` filter
- Graph traversal respects project boundaries by default (configurable)

---

## 3. Non-Blocking Indexer Init with Notification

### 3.1 Current Blocking Flow

```typescript
// packages/memory/src/memory.ts:51-62
const makeMemoryService = Effect.gen(function* () {
  // ...yield* services
  console.log("[DEBUG] MemoryLive.init: All services obtained, initializing indexer")
  yield* indexer.initialize()  // BLOCKS HERE - 9 DDL statements
  // ...rest of service
})
```

### 3.2 Target Architecture

```typescript
const makeMemoryService = Effect.gen(function* () {
  const scope = yield* Scope.Scope
  const indexer = yield* IndexerService
  // ...other services

  // FIRE-AND-FORGET background initialization
  const initFiber = yield* Effect.forkIn(
    indexer.initialize().pipe(
      Effect.tap(() => notifyIndexerReady()),
      Effect.catchCause((cause) => Effect.logError("Indexer init failed", { cause }))
    ),
    scope
  )

  // Return service IMMEDIATELY — init runs in background
  return {
    // ...service methods
    // Add: waitForIndexer(): Effect<void> — for callers that need init complete
    // Add: onIndexerReady(callback): Effect<void> — subscription
  }
})
```

### 3.3 Notification System

**Option A: Effect PubSub (internal)**
- `IndexerService` exposes `ready: Deferred<void>` or `PubSub<void>`
- Callers `yield* indexer.ready.await` or subscribe

**Option B: EventV2 Bridge (existing)**
- Emit `indexer.ready` event via `EventV2` service
- UI/components can listen via existing event stream

**Option C: Simple Callback Registry**
- `indexer.onReady(fn)` stores callbacks, fires when done

**Recommendation**: Option A (Effect `Deferred` or `PubSub`) — lightweight, no extra deps, fits Effect architecture.

### 3.4 Implementation Steps

1. **Add `ready: Deferred<void>` to `IndexerService` interface**
2. **In `makeIndexer`**: Create `Deferred.make<void>()`, succeed it after `initialize()` completes
3. **In `makeMemoryService`**: Fork `initialize()` with `Effect.forkIn(scope)`, don't await
4. **Add `waitForIndexer(): Effect<void>` to `MemoryService`** — yields `yield* indexer.ready.await`
5. **Wire notification**: After `initialize()` succeeds, `Deferred.succeed(ready, void 0)` + emit `EventV2` event `"memory.indexer.ready"`
6. **Update callers**: Any code that needs indexer ready (e.g., first search) calls `waitForIndexer()`

### 3.5 Startup Impact

- **Before**: Server blocks ~10-50ms on 9 DDL statements
- **After**: Server responds immediately; indexer init runs in background
- **Race condition handled**: First memory operation auto-waits via `waitForIndexer()`

---

## 4. Execution Order & Dependencies

```
Phase 1: Path Rebranding (independent, do first)
  ├── 1.1 global.ts app name change
  ├── 1.2 flag.ts env var aliases
  ├── 1.3 config.ts .diveeoi config dir
  ├── 1.4 Migration logic in global.ts layer
  └── 1.5 Test: fresh install + existing opencode user

Phase 2: Memory Multi-Project (depends on Phase 1 for paths)
  ├── 2.1 Schema migration (DB)
  ├── 2.2 ProjectRegistry service
  ├── 2.3 Indexer enhancements
  ├── 2.4 NodeService fallbacks
  └── 2.5 Recall project filtering

Phase 3: Non-Blocking Indexer (can parallel with Phase 2)
  ├── 3.1 Add Deferred to IndexerService
  ├── 3.2 Fork init in MemoryLive
  ├── 3.3 Add waitForIndexer to MemoryService
  ├── 3.4 EventV2 notification
  └── 3.5 Update callers
```

---

## 5. Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Breaking existing opencode users | Medium | High | Env var aliases, auto-migration, test both paths |
| DB migration failure | Low | High | Idempotent migrations, backup before migrate |
| Memory file orphan detection false positives | Medium | Medium | Verify with `fs.existsSync`, log before marking |
| Race: indexer not ready when first request hits | Medium | Medium | `waitForIndexer()` auto-called in service methods |
| Project detection misses nested projects | Low | Medium | Configurable scan depth, manual `registerProject` API |

---

## 6. Testing Checklist

- [ ] Fresh install creates `~/.local/share/diveeoi/`
- [ ] Existing opencode install auto-migrates DB + config
- [ ] `OPENCODE_*` env vars still work (deprecated)
- [ ] `DIVEEOI_*` env vars take precedence
- [ ] Memory loads from multiple project dirs
- [ ] Deleted memory files marked orphaned, not lost
- [ ] Server boots <100ms (indexer in background)
- [ ] Notification fires on indexer ready
- [ ] Recall filters by project correctly

---

## 7. Files to Create/Modify Summary

### New Files
- `packages/memory/src/project-registry.ts` — ProjectRegistryService
- `packages/db/src/database/migration/{timestamp}_memory_projects.ts` — Schema migration

### Modified Files
- `packages/db/src/global.ts` — app name, migration logic
- `packages/db/src/flag/flag.ts` — DIVEEOI_* env vars with OPENCODE_* fallbacks
- `packages/db/src/config.ts` — .diveeoi config dir detection
- `packages/memory/src/indexer.ts` — Deferred ready, project columns, orphan detection
- `packages/memory/src/memory.ts` — forkIn init, waitForIndexer
- `packages/memory/src/node.ts` — project assignment, fallback reads
- `packages/memory/src/schema.ts` — new schema types
- `packages/memory/src/config.ts` — verify memoryDir default

---

## 8. Backward Compatibility & Configurable Disables

### 8.1 Backward Compatibility Guarantees

| Feature | Old Behavior | New Behavior | Fallback |
|---|---|---|---|
| Config dir | `~/.config/opencode/` | `~/.config/diveeoi/` | Auto-migrate on first run; read both |
| Data dir | `~/.local/share/opencode/` | `~/.local/share/diveeoi/` | Auto-migrate DB; read both |
| Cache dir | `~/.cache/opencode/` | `~/.cache/diveeoi/` | No migration needed (ephemeral) |
| State dir | `~/.local/state/opencode/` | `~/.local/state/diveeoi/` | No migration needed |
| Project config | `.opencode/` | `.diveeoi/` | Detect both; prefer `.diveeoi` |
| Memory dir | `.divee/memory/` | `.divee/memory/` | Unchanged |
| Env vars | `OPENCODE_*` | `DIVEEOI_*` (primary) | `OPENCODE_*` read as deprecated alias |
| DB filename | `opencode.db` | `diveeoi.db` | Auto-copy if only old exists |

**Migration is one-way, idempotent, and logged**. Users can disable auto-migration via config.

### 8.2 Config Schema for Disables

Add to `MemoryConfigShape` (`packages/memory/src/config.ts`):

```typescript
export class MemoryConfigShape extends Schema.Class<MemoryConfigShape>("MemoryConfig")({
  memoryDir: AbsolutePath,
  recall: RecallConfig,
  session: SessionConfig,
  consolidation: ConsolidationConfig,
  // NEW: Feature toggles
  features: Schema.Struct({
    multiProject: Schema.Boolean.pipe(Schema.withDefault(true)),      // Load from all projects
    autoDetectProjects: Schema.Boolean.pipe(Schema.withDefault(true)), // Scan for .divee/memory/
    orphanDetection: Schema.Boolean.pipe(Schema.withDefault(true)),   // Mark missing files
    projectBoundaries: Schema.Boolean.pipe(Schema.withDefault(true)), // Filter recall by project
    nonBlockingInit: Schema.Boolean.pipe(Schema.withDefault(true)),   // Background indexer init
    notifications: Schema.Boolean.pipe(Schema.withDefault(true)),     // Indexer ready events
    legacyOpencodePaths: Schema.Boolean.pipe(Schema.withDefault(true)), // Read old opencode paths
  }),
}) {}
```

Add to `Config` schema (`packages/db/src/config.ts`) for global disables:

```typescript
export class ConfigShape extends Schema.Class<ConfigShape>("Config")({
  // ... existing fields
  // NEW: Global feature flags
  features: Schema.Struct({
    pathMigration: Schema.Boolean.pipe(Schema.withDefault(true)),      // Auto-migrate opencode→diveeoi
    legacyConfigDirs: Schema.Boolean.pipe(Schema.withDefault(true)),   // Read ~/.config/opencode etc
    legacyEnvVars: Schema.Boolean.pipe(Schema.withDefault(true)),      // Accept OPENCODE_* env vars
    crossProjectMemory: Schema.Boolean.pipe(Schema.withDefault(true)), // Memory across projects
  }),
}) {}
```

**All defaults = true** for smooth upgrade. Users opt-out per-feature.

### 8.3 Disable Implementation

Each feature gate checks config before executing:

```typescript
// Example: multi-project loading
const loadAllProjects = (): Effect.Effect<MemoryNode[], MemoryError> =>
  Effect.gen(function* () {
    const config = yield* MemoryConfig
    if (!config.features.multiProject) {
      return yield* loadCurrentProjectOnly() // old behavior
    }
    return yield* loadFromAllProjects()
  })
```

---

## 9. Cross-Platform Support (Windows, macOS, Linux)

### 9.1 Path Handling

| Platform | XDG Base | `xdg-basedir` behavior | Our handling |
|---|---|---|---|
| **Linux** | `~/.local/share`, `~/.config`, `~/.cache`, `~/.local/state` | Standard XDG | Use `xdg-basedir` directly |
| **macOS** | `~/Library/Application Support`, `~/Library/Preferences`, `~/Library/Caches`, `~/Library/Application Support` | `xdg-basedir` maps to macOS dirs | Use `xdg-basedir` (it handles this) |
| **Windows** | `%LOCALAPPDATA%`, `%APPDATA%`, `%LOCALAPPDATA%`, `%LOCALAPPDATA%` | `xdg-basedir` maps to Windows dirs | Use `xdg-basedir` (it handles this) |

**`xdg-basedir` package already handles all three platforms correctly**. No changes needed to `global.ts` — just change `app = "diveeoi"`.

### 9.2 Path Separators & Case Sensitivity

- **Always use `path.join()` / `path.resolve()`** — never string concat with `/`
- **File existence checks**: Use `fs.existsSync()` / `fs.promises.access()` — works cross-platform
- **Case sensitivity**: Windows/macOS are case-insensitive by default; Linux is case-sensitive
  - Store paths in DB as-is (preserve case)
  - Compare with `path.resolve(a) === path.resolve(b)` after normalization
  - Use `path.normalize()` before comparisons

### 9.3 Memory Dir Default

```typescript
// packages/memory/src/config.ts
memoryDir: ".divee/memory" as AbsolutePath  // Relative — works everywhere
```

**No absolute paths in defaults**. Relative to CWD works on all platforms.

### 9.4 SQLite & File Locking

- SQLite WAL mode (`PRAGMA journal_mode = WAL`) works on all platforms
- Windows: mandatory locking via OS; Unix: advisory locking
- **No changes needed** — current `sqlite.bun.ts` already uses WAL

### 9.5 Environment Variables

- Windows: `set DIVEEOI_CONFIG_DIR=...` or PowerShell `$env:DIVEEOI_CONFIG_DIR="..."`
- Unix: `export DIVEEOI_CONFIG_DIR=...`
- **Code reads `process.env`** — platform-agnostic

### 9.6 Testing Matrix

| Test | Linux | macOS | Windows |
|---|---|---|---|
| Fresh install creates dirs | ✅ | ✅ | ✅ |
| Opencode migration works | ✅ | ✅ | ✅ |
| Memory multi-project loads | ✅ | ✅ | ✅ |
| Orphan detection accurate | ✅ | ✅ | ✅ |
| Non-blocking init works | ✅ | ✅ | ✅ |
| Notifications fire | ✅ | ✅ | ✅ |
| Config disables work | ✅ | ✅ | ✅ |
| Case-insensitive paths work | N/A | ✅ | ✅ |

**CI should run on all three**. GitHub Actions: `ubuntu-latest`, `macos-latest`, `windows-latest`.

---

## 10. Updated Files Summary (with new sections)

### New Files
- `packages/memory/src/project-registry.ts` — ProjectRegistryService
- `packages/db/src/database/migration/{timestamp}_memory_projects.ts` — Schema migration

### Modified Files
- `packages/db/src/global.ts` — app name, migration logic, feature gates
- `packages/db/src/flag/flag.ts` — DIVEEOI_* env vars with OPENCODE_* fallbacks, feature flags
- `packages/db/src/config.ts` — .diveeoi config dir detection, global feature toggles
- `packages/memory/src/indexer.ts` — Deferred ready, project columns, orphan detection, feature gates
- `packages/memory/src/memory.ts` — forkIn init, waitForIndexer, feature gates
- `packages/memory/src/node.ts` — project assignment, fallback reads, feature gates
- `packages/memory/src/schema.ts` — new schema types (ProjectInfo, etc.)
- `packages/memory/src/config.ts` — MemoryConfigShape with feature toggles

---

**Next Step**: Review this updated plan. If approved, I'll start with Phase 1 (Path Rebranding) as it's the foundation for everything else.