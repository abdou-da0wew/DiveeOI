# DiveeOI Fix Plan — Session Auto-Title, File Picker UX, User Prefs Sync, Auth Persistence

## Overview

Four bug groups to fix in DiveeOI after deep research of the codebase. Each group is a self-contained batch that can be implemented by subagents in parallel (except Batch 2a and 2b which must be sequential).

---

## Batch 1: Session Auto-Title Retry & Fallback

### Problem
`ensureTitle()` in `packages/server/src/session/prompt.ts:218-278` runs once on the first user message. If the LLM call fails (caught by `Effect.catchCause` at line 277), the title stays as the default `"New session - <ISO timestamp>"` or `"Child session - <ISO timestamp>"` forever — no retry mechanism exists.

### Files to change
1. **`packages/server/src/session/prompt.ts`** (~20 lines changed)
2. **`packages/server/src/session/session.ts`** (~5 lines changed)

### Changes

#### `packages/server/src/session/prompt.ts` — Retry mechanism

**Current behavior (lines 218-278):**
- `ensureTitle()` exits early if `parentID` is set (line 224) or title is not default (line 225)
- First line of history is sent to LLM to generate title (lines 227-274)
- `catchCause` swallows ALL failures silently (line 277)

**New behavior:**
- `ensureTitle()` must also be called on subsequent messages (not just the first), but only if the title is still the default
- Use a simpler fallback strategy: if LLM call fails, try again on the next user message
- Add a local flag (e.g. `titleAttempted: boolean` on the session) to avoid infinite retries — only retry if title is still default AND `titleAttempted < 3`

**Implementation:**
```typescript
// In prompt.ts, modify ensureTitle to be callable multiple times
const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
  session: Session.Info
  history: SessionV1.WithParts[]
  providerID: ProviderV2.ID
  modelID: ModelV2.ID
}) {
  if (input.session.parentID) return       // no title for child sessions
  if (!Session.isDefaultTitle(input.session.title)) return  // already has a title
  if (input.session.titleAttempted >= 3) return  // give up after 3 tries

  // ... same title generation logic ...
  
  yield* sessions
    .setTitle({ sessionID: input.session.id, title: t })
    .pipe(Effect.catchCause((cause) => 
      Effect.logError("failed to generate title", { error: Cause.squash(cause) })
    ))
    
  // Increment titleAttempted regardless of success/failure
  yield* sessions.incrementTitleAttempts({ sessionID: input.session.id })
})
```

**Call site change:** Find where `ensureTitle()` is called (likely once per first message). Change it to be called on EVERY user message, but the early returns in `ensureTitle()` will prevent unnecessary LLM calls after a title is set or after 3 failures.

#### `packages/server/src/session/session.ts` — Add `titleAttempted` counter

```typescript
export interface SessionInfoFields {
  // ... existing fields ...
  titleAttempted: number  // number of times we tried to generate a title
}
```

Add:
- `incrementTitleAttempts({ sessionID })` — increments the counter
- Default `titleAttempted: 0` on new sessions (line 563 area)

### Verification
- Start a new session with no internet/API key — title stays as "New session - ...", but logs show retry attempts
- Start a new session with a working API key — title is set within 3 messages
- Child sessions never get auto-titled (unchanged behavior)

---

## Batch 2a: File Picker — Trash Exclusion & Search Improvements

### Problem
1. No trash directory filtering anywhere — `.Trash`, `$trash`, `node_modules`, etc. show up in file tree
2. `pickerSearchEntries` and search results show all directories with no depth limit
3. Search path display shows `~/` for home-relative but full paths for everything else — inconsistent

### Files to change
1. **`packages/app/src/components/directory-picker-domain.ts`** (~40 lines changed)
2. **`packages/app/src/components/directory-picker-domain.test.ts`** (~20 lines changed)
3. **`packages/app/src/components/dialog-select-directory-v2.tsx`** (~10 lines changed)

### Changes

#### `directory-picker-domain.ts` — Trash directory filter + search improvements

**Add filter function:**
```typescript
// Default trash directory names to filter out
const TRASH_DIR_NAMES = new Set([
  ".Trash", "$trash", "node_modules", ".git", ".cache", 
  "tmp", ".tmp", "__pycache__", ".DS_Store", "target",
  "dist", ".next", ".turbo", "build",
])

export function isIgnoredDirectory(name: string): boolean {
  return name.startsWith(".") || TRASH_DIR_NAMES.has(name) || name.includes("$trash")
}
```

**Modify `treeEntries()` (line 1) — filter ignored dirs:**
```typescript
export function treeEntries(parent: string, nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>) {
  const prefix = parent.replace(/^\/+|\/+$/g, "")
  return nodes
    .filter((node) => !(node.type === "directory" && isIgnoredDirectory(node.name)))
    .map((node) => {
      const path = prefix ? `${prefix}/${node.name}` : node.name
      return node.type === "directory" ? path + "/" : path
    })
}
```

**Modify `pickerSearchEntries()` (line 17):**
```typescript
export function pickerSearchEntries<T extends { type: "file" | "directory" }>(
  nodes: readonly T[],
  mode: "directory" | "file",
) {
  return (mode === "directory" ? nodes.filter((node) => node.type === "directory") : [...nodes])
    .filter((node) => !(node.type === "directory" && isIgnoredDirectory(node.name)))
}
```

**Modify `directories()` function in `createDirectorySearch()` (line 268):**
```typescript
const directories = async (directory: string) => {
  const key = trimPickerPath(directory)
  const existing = cache.get(key)
  if (existing) return existing
  const request = args.sdk.client.file
    .list({ directory: key, path: "" })
    .then((result) => result.data ?? [])
    .catch(() => [])
    .then((nodes) =>
      nodes
        .filter((node) => node.type === "directory" && !isIgnoredDirectory(node.name))
        .map((node) => ({ name: node.name, absolute: trimPickerPath(normalizePickerDrive(node.absolute)) })),
    )
  cache.set(key, request)
  return request
}
```

**Modify `displayPickerPath()` to always show full relative paths:**
The current behavior returns `~/` for home-relative paths (line 248). Instead, always show the full path (the `~/` shorthand is confusing). Remove the `pickerTilde()` call and use `value` directly:

```typescript
export function displayPickerPath(path: string, input: string, home: string) {
  const value = trimPickerPath(path)
  if (/^[A-Za-z]:\//.test(trimPickerPath(home)) || /^[A-Za-z]:\//.test(value)) 
    return value.replaceAll("/", "\\")
  return value  // was: pickerTilde(value, home) || value
}
```

#### `dialog-select-directory-v2.tsx` — Adjust suggestions display

The `displayPickerPath()` change above fixes the path display in suggestions. No other changes needed here for path display.

### Verification
- Open file picker in `/home/user` — `.Trash`, `node_modules`, `.git` directories don't appear
- File tree shows clean directory listing
- Search results exclude ignored directories
- Path display shows full paths (e.g., `/home/user/projects/my-app` not `~/projects/my-app`)

---

## Batch 2b: Open Project Classification — Home Page + File Picker

### Problem
1. The file picker's "Open project" section dumps ALL first-level home subdirectories with no classification or depth limit
2. The home page (`HomeProjectList`) only shows manually-added projects — no auto-classification at all
3. Both should share the same classification logic: depth-limited (2-3 levels), no hidden/trash dirs, grouped by language/project type

### Files to change
1. **`packages/app/src/components/directory-picker-domain.ts`** — Add project classification logic (~60 lines new)
2. **`packages/app/src/components/dialog-select-directory-v2.tsx`** — Use classification for "Open project" section (~20 lines)
3. **`packages/app/src/pages/home.tsx`** — Use same classification logic in sidebar (~20 lines)
4. **`packages/app/src/context/server.tsx`** — Extend project storage to include auto-classified projects (~10 lines)

### Changes

#### New shared function in `directory-picker-domain.ts`:

```typescript
export interface ClassifiedProject {
  worktree: string
  name: string
  type: "project" | "sandbox" | "other"
  language?: string  // detected from known files
}

// Detect project type from filename/directory contents
const PROJECT_INDICATORS = {
  "package.json": "node",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "pom.xml": "java",
  "build.gradle": "java",
  "Gemfile": "ruby",
  "requirements.txt": "python",
  "setup.py": "python",
  "*.csproj": "dotnet",
  "*.sln": "dotnet",
}

// Max depth for Open Project auto-classification
const OPEN_PROJECT_MAX_DEPTH = 3

export async function classifyOpenProjects(
  sdk: ServerSDK,
  homeDir: string,
  existingProjects: string[],
): Promise<ClassifiedProject[]> {
  // Called with depth limit = OPEN_PROJECT_MAX_DEPTH
  // Returns classified projects from home directory tree
  // Filters:
  //   - Only directories with detected project indicators or known project patterns
  //   - No ignored/trash directories
  //   - Max 3 levels deep from home
  //   - Existing manually-added projects at any depth
  // Deduplicates against existingProjects
  //
  // Implementation:
  //   - Walk homeDir up to 3 levels using SDK file.list
  //   - At each directory, check for PROJECT_INDICATORS
  //   - Classify: "project" if has indicator files, "sandbox" if casual code, "other" otherwise
  //   - Note: SDK file.list returns {name, type, absolute} — use .absolute for full path, .name for filename
}
```

**Key considerations:**
- Must be callable from both `directory-picker-domain.ts` (server-side via SDK) and `home.tsx` (client-side via SDK)
- Must share TRASH_DIR exclusion from Batch 2a
- Must handle dedup: don't show home dir itself, don't show existing manually-added projects
- Limit to 3 levels deep to avoid performance issues with deep nested trees like `node_modules`

#### Home page integration:

In `packages/app/src/pages/home.tsx`:
- Add `SemanticProjectList` component that calls `classifyOpenProjects()` 
- Place it above or alongside `HomeProjectList`
- Auto-classified projects appear as a "Suggested" section below manually-added projects
- Uses the same `openProjectNewSession` handler

#### File picker integration:

In `packages/app/src/components/dialog-select-directory-v2.tsx`:
- Add a "Suggested Projects" section at the top of suggestions (or as a separate group below the input)
- Uses `classifyOpenProjects()` with the same depth limit
- Displays: directory name + language badge (if detected)
- Selecting navigates to that directory

### Verification
- Home page shows auto-classified projects under a "Suggested" header
- File picker shows suggested projects at the top of the suggestions list
- Both use the same depth limit and filtering
- No performance impact on large home directories (capped at 3 levels, 50 results)

---

## Batch 3: Server-Side User Prefs Storage + Client Sync on Login

### Problem
All user preferences (settings, layout, theme, models, providers, etc.) are stored exclusively in `localStorage` via the `persisted()` utility. No server-side storage exists. When a user logs in from a different browser or clears localStorage, all preferences are lost.

### Files to change
1. **`packages/db/src/database/schema.sql.ts`** — Add user_prefs table (~20 lines)
2. **`packages/db/src/database/migration/`** — New migration file (~20 lines)
3. **`packages/server/src/prefs/`** — New Effect service module (~100 lines)
4. **`packages/api/src/groups/settings.ts`** — New API group (~80 lines)
5. **`packages/app/src/context/settings.tsx`** — Add server sync logic (~50 lines)
6. **`packages/app/src/context/layout.tsx`** — Add server sync logic (~30 lines)
7. **`packages/app/src/utils/persist.ts`** — Add server persist target (~30 lines) — OR just write/read manually

### Changes

#### New DB table (schema.sql.ts):

```typescript
// migrations
export const UserPrefsTable = sqliteTable("user_prefs", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),              // e.g. "settings.v3", "layout.v2"
  value: text("value").notNull(),          // JSON string
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
})
```

#### New migration:

Create `20260728_add_user_prefs.ts`:
```typescript
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { type Schema } from "./_schema"

export default (schema: Schema) => ({
  ...schema,
  user_prefs: sqliteTable("user_prefs", {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  }),
})
```

#### New server module `packages/server/src/prefs/prefs.ts`:

```typescript
import { Effect, Layer, Context } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { UserPrefsTable } from "@diveeoi/db/database/schema.gen"
import { eq } from "drizzle-orm"

export class Prefs extends Context.Service<Prefs, Prefs>()("@diveeoi/Prefs") {
  get = (key: string) => Effect.fnUntraced(function* () {
    const db = yield* Database.Service
    const row = yield* db.execute((tx) =>
      tx.select().from(UserPrefsTable).where(eq(UserPrefsTable.key, key)).limit(1)
    )
    return row[0] ? JSON.parse(row[0].value) : undefined
  })

  set = (key: string, value: unknown) => Effect.fnUntraced(function* () {
    const db = yield* Database.Service
    const json = JSON.stringify(value)
    yield* db.execute((tx) =>
      tx.insert(UserPrefsTable).values({
        id: key,
        key,
        value: json,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: UserPrefsTable.id,
        set: { value: json, updatedAt: new Date().toISOString() },
      })
    )
  })

  list = () => Effect.fnUntraced(function* () {
    const db = yield* Database.Service
    const rows = yield* db.execute((tx) => tx.select().from(UserPrefsTable))
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) }))
  })
}

export const PrefsLive = Layer.effect(Prefs, Prefs).pipe(Layer.provide(Database.defaultLayer))
```

#### New API group `packages/api/src/groups/settings.ts`:

```typescript
// GET /prefs — returns all user prefs
// PUT /prefs/:key — upsert one pref
// DELETE /prefs/:key — delete one pref

export class SettingsApi extends HttpApi.group("settings")
  .add(
    HttpApi.get("list", "/prefs", {
      response: Schema.Array(Schema.Struct({
        key: Schema.String,
        value: Schema.Unknown,
      })),
    })
  )
  .add(
    HttpApi.put("set", "/prefs/:key", {
      request: Schema.Struct({ value: Schema.Unknown }),
      response: Schema.Void,
    })
  )
  .add(
    HttpApi.delete("delete", "/prefs/:key", {
      response: Schema.Void,
    })
  )
{}
```

#### Client-side changes (`settings.tsx`):

```typescript
// Add a sync effect that:
// 1. On initial load, fetches prefs from server (GET /prefs)
// 2. Merges server prefs into local store (server wins for each key)
// 3. On every local change, sends PUT /prefs/:key with the new value
// 4. Debounce local→server writes (500ms) to avoid flooding

createEffect(() => {
  const server = global.current.server
  if (!server) return
  
  // Fetch server settings on load
  fetch(`/api/prefs/list`, {
    headers: { Authorization: `Basic ${btoa(server.http.username + ":" + server.http.password)}` }
  })
    .then(r => r.json())
    .then(prefs => {
      const serverPrefs = prefs.find(p => p.key === "settings.v3")
      if (serverPrefs) {
        setStore(reconcile(serverPrefs.value))  // server wins
      }
    })
})
```

**Important design decisions:**
- Server prefs are keyed by the same keys used in `Persist.global()` (e.g. `"settings.v3"`, `"server"`)
- On sync, server value wins for the initial load (consistency across browsers)
- Local changes are debounced and pushed to server
- No conflict resolution needed for v1 (last-write-wins is fine)

### Verification
- Open app in browser A, change theme → close
- Open app in browser B (same server creds) → theme is applied
- Clear localStorage → reload → settings are restored from server
- API endpoints return 200 for GET/PUT/DELETE

---

## Batch 4: Auth Persistence — Health Check on Browser Reload

### Problem
Credentials persist in localStorage via `persisted("server")` (server.tsx:229). On browser reopen:
1. `resolveServerList()` at lines 114-145 merges stored servers with props — username/password survive
2. `add()` at line 258 strips `authToken: undefined` — but `createSdkForServer()` creates Basic auth from stored creds anyway
3. In `entry.tsx`, `auth_token` URL param is read and then cleared — on subsequent reloads, no URL param
4. The connection dialog may re-prompt if a health check on the stored server entry fails

### Files to investigate/change
1. **`packages/app/src/context/server.tsx`** — Possibly adjust `add()` to not strip `authToken` (~5 lines)
2. **`packages/app/src/entry.tsx`** — Verify auth flow on reload (~10 lines)
3. **`packages/app/src/components/dialog-connect-server.tsx`** — Possibly the dialog that re-prompts

### Changes (if needed — depends on testing)

The auth flow on reload should work already:
1. `entry.tsx` renders → `ServerProvider` initializes → `persisted("server")` reads stored servers from localStorage
2. `resolveServerList()` merges props with stored — stored creds survive
3. `createSdkForServer()` builds Basic auth from `username`/`password` — API calls work
4. No URL param `auth_token` → stored creds used directly

**Potential issue:** If the connection dialog opens on reload (e.g., when `allServers()` array is empty or when health check fails on the stored URL), the fix might be:
- In `entry.tsx`, after loading stored servers, skip connection dialog if a server with non-empty credentials exists
- Or: in the connection dialog, skip health checks if stored creds are present

**If local testing shows the dialog re-prompts:**

In `entry.tsx` (or wherever `DialogConnectServer` is triggered), add:
```typescript
// If we have stored credentials, don't show the connection dialog
const storedServers = store.list
if (storedServers.length > 0 && storedServers.some(s => typeof s === "object" && (s.username || s.password))) {
  // Skip connection dialog, use stored server
  return
}
```

### Verification
- Open app, connect to server, close browser
- Reopen browser → no connection prompt, sessions load
- Wait 30+ seconds → no re-prompt on failed health check

---

## Implementation Order

```
Batch 1: Session auto-title (subagent A)
                                          \
Batch 2a: File picker trash + search (subagent B)  -->  Batch 2b: Classify projects (subagent C)
                                          /
Batch 3: User prefs sync (subagent D)

Batch 4: Auth persistence (subagent E, smaller scope)
```

### Dependencies
- **Batch 2b depends on Batch 2a** (shares `isIgnoredDirectory` and TRASH_DIR_NAMES)
- Batches 1, 2a, 3, 4 are independent and can run in parallel
- After all batches: final review pass

### Risk Areas
1. **Batch 3 (DB migration):** Must be compatible with existing SQLite schema. Need to verify migration framework.
2. **Batch 2b (classifyOpenProjects):** Must be async with error handling since it calls SDK. Must gracefully degrade if SDK call fails (show nothing, don't crash).
3. **Batch 1 (title retry):** Must not generate a title on EVERY message — just once per session until success or 3 failures.
4. **Batch 2a (displayPickerPath change):** Removing `~/` may affect existing UX expectations. Consider adding configuration instead of hard removal.

### Rollback Plan
- Each batch is self-contained with clear file changes
- `git diff` before/after for each change
- If a fix breaks, revert the specific file changes for that batch

---

## How to Implement with Subagents

1. Load this plan into the subagent's prompt
2. Each subagent reads the relevant files first (already confirmed)
3. Subagent writes changes per file-level specification above
4. Subagent runs `bun turbo typecheck` in the project root after changes
5. After all subagents complete, run full typecheck and lint