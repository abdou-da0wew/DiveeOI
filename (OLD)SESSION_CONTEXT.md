# Session Context: Compaction Parsing Bug Fix (2026-07-06)

## Origin

This session was started to fix a bug: **during session compaction, the agent receives a malformed JSON payload (a raw V1 `WithParts` structure with `"role":"user"` and a `"type":"compaction"` part) instead of proper text content, causing the agent to "fully forget everything".**

---

## The Malformed Payload

The user showed this exact JSON as what the agent receives:

```json
{
  "message": {
    "id": "msg_f36c14d2f001YTWPjDjyCHCFDb",
    "role": "user",
    "model": { "providerID": "opencode", "modelID": "deepseek-v4-flash-free" },
    "sessionID": "ses_0c97a3ea8ffeDQy1MxFMh6fH7j",
    "agent": "build",
    "time": { "created": 1783330065711 },
    "summary": { "diffs": [] }
  },
  "parts": [{
    "id": "prt_f36c14d49001SXH4mEYKC6AoyW",
    "messageID": "msg_f36c14d2f001YTWPjDjyCHCFDb",
    "sessionID": "ses_0c97a3ea8ffeDQy1MxFMh6fH7j",
    "type": "compaction",
    "auto": false
  }]
}
```

Key characteristics:
- This is a **V1 `WithParts` structure** (not a V2 `SessionMessage`)
- It has `"role": "user"` but the only part is a `"compaction"` type with no text
- `"auto": false` means it was a manual compaction trigger
- `"summary": {"diffs": []}` is the default empty summary metadata
- This raw JSON is being sent as the text content of a user message to the LLM, which confuses it

---

## Architecture Overview

### Two Parallel Message Systems

**V1 (old)** — used by the prompt loop in `packages/server/src/session/prompt.ts`:
- Messages stored in `MessageTable` + `PartTable` (SQLite)
- Format: `WithParts` = `{ info: User|Assistant, parts: Part[] }`
- Compaction is a **Part** of a user message (`CompactionPart`)
- Converted to LLM messages via `message-v2.ts:toModelMessagesEffect()` → `convertToModelMessages()` (Vercel AI SDK)
- Runs the main `build` agent loop in `prompt.ts`

**V2 (new)** — used by the durable runner in `packages/db/src/session/runner/llm.ts`:
- Messages stored in `SessionMessageTable` (SQLite)
- Format: `SessionMessage.Message` tagged union (User, Assistant, Compaction, etc.)
- Compaction is a **top-level message type** (`SessionMessage.Compaction`) with `summary` and `recent` fields
- Converted to LLM messages via `to-llm-message.ts:toLLMMessages()`
- Uses `SessionHistory.loadForRunner()` → `messageRows()` with compaction-aware filtering
- Guards: `SessionMessage.ID` wraps ULID strings

### How Compaction Works (V1 path)

1. **Trigger**: In `prompt.ts` line 1258, when `compaction.isOverflow()` returns true after an assistant finishes, `compaction.create()` is called
2. **Create**: `packages/server/src/session/compaction.ts:create()` — adds a `CompactionPart` (type:"compaction", auto:true/false) to a new user message
3. **Process**: On the next loop iteration, `latest()` finds the compaction part as a `task`, calls `compaction.process()` (line 1247) → `processCompaction()`
4. **processCompaction()** (line 299):
   - Loads `history` = filtered V1 messages (removing the compaction trigger message and any previous compaction messages)
   - Builds `modelMessages` = `toModelMessagesEffect(history, model)` — converts V1 history to ModelMessage[]
   - Gets `anchoredPrompt` = `buildPrompt()` from `@diveeoi/db/session/compaction`
   - Calls the LLM with: `[...modelMessages, { role:"user", content: anchoredPrompt }]`
   - Stores the result as an assistant message with `summary: true`
   - Updates the compaction part with `tail_start_id`
   - Publishes `SessionEvent.Compaction.Ended` if `flags.experimentalEventSystem` is enabled
5. **Post-compaction**: `filterCompacted()` reorders messages — puts compaction user + summary first, then retained tail, then rest

### How Compaction Works (V2 path)

1. **Trigger**: In `runner/llm.ts` line 228, `compactIfNeeded()` checks token count
2. **compactIfNeeded()**: Calls the compaction LLM, gets summary, publishes events, creates a `SessionMessage.Compaction` via the event system projection
3. **toLLMMessages()**: Handles Compaction messages by wrapping them in a `<conversation-checkpoint>` block

### Compaction Part vs Compaction Message

**V1 CompactionPart** (`packages/server/src/session/message-v2.ts` types):
```typescript
type CompactionPart = {
  id: string
  messageID: string
  sessionID: string
  type: "compaction"
  auto: boolean
  overflow?: { model: Provider.Model; tokens: number }
  tail_start_id?: string
}
```
Minimal — no `summary`, no `recent`. Summary is in the paired assistant message.

**V2 Compaction message** (`packages/db/src/session/message.ts`):
```typescript
type Compaction = {
  id: SessionMessage.ID
  type: "compaction"
  sessionID: SessionSchema.ID
  seq: number
  time_created: DateTime
  summary: string
  recent: string
  reason: "auto" | "manual"
  metadata?: Record<string, unknown>
}
```
Has full `summary` and `recent` text fields.

---

## The Bug: Likely Root Cause

The malformed JSON is a **raw V1 `WithParts` object** that ends up as text content sent to the LLM. The most likely cause is in how `toModelMessagesEffect()` (V1 conversion) handles a user message that has ONLY a compaction part and no text parts.

### In `message-v2.ts` lines 239-243:
```typescript
if (part.type === "compaction") {
  userMessage.parts.push({
    type: "text",
    text: "What did we do so far?",
  })
}
```

When a user message has `parts: [{type: "compaction", ...}]` and `msg.parts.length === 1`:
1. The compaction part is processed at line 239, adding `{type:"text", text:"What did we do so far?"}` to the UIMessage
2. `userMessage.parts` = `[{type:"text", text:"What did we do so far?"}]`
3. `userMessage.parts.length > 0` is true, so the message is included in the result

This *should* work correctly and produce a proper text message. But the bug report shows RAW JSON being sent, not "What did we do so far?". This suggests there's a **code path where `toModelMessagesEffect` is bypassed entirely**, and the raw `WithParts` object is serialized directly.

### Suspect areas:

1. **`prompt.ts` line 1247**: When `task.type === "subtask"` (not compaction), the task is a `SubtaskPart` and the TaskTool spawns a sub-agent. If the subtask receives the raw message structure, this could be the leak.

2. **The V2 runner loading V1 messages**: `SessionHistory.load()` in `db/src/session/history.ts` queries `SessionMessageTable`. If V1 user messages with compaction parts somehow end up in this table (via the V1→V2 projector), and the `decodeMessageRow()` fails to decode them as proper `SessionMessage.User`, it could produce garbled output.

3. **`filterCompacted()` in `message-v2.ts`**: After compaction completes, the reordered message array puts the compaction user + summary first. If the compaction user message still has the original `CompactionPart` but the `toModelMessagesEffect()` conversion is somehow skipped for this reordered array...

4. **Race condition**: A compaction task is processed while another LLM call is in-flight, causing a double-send of messages where one path uses raw V1 and the other uses converted messages.

---

## Key Files (in investigation order)

| File | Path | Role |
|---|---|---|
| **prompt.ts** | `packages/server/src/session/prompt.ts` | Main prompt loop; detects compaction tasks, calls `compaction.process()`, builds agent context |
| **compaction.ts** (server) | `packages/server/src/session/compaction.ts` | V1 compaction orchestration: `create()`, `processCompaction()`, overflow checking |
| **message-v2.ts** | `packages/server/src/session/message-v2.ts` | V1→LLM conversion: `toModelMessagesEffect()`, `filterCompacted()`, `latest()`, V1 types |
| **compaction.ts** (db) | `packages/db/src/session/compaction.ts` | DB-layer: `buildPrompt()`, `verifyCompact()`, `compactIfNeeded()` for V2 |
| **to-llm-message.ts** | `packages/db/src/session/runner/to-llm-message.ts` | V2→LLM conversion: `toLLMMessages()`, handles Compaction messages with `<conversation-checkpoint>` |
| **processor.ts** | `packages/server/src/session/processor.ts` | Message processing, tool call handling, LLM streaming |
| **runner/llm.ts** | `packages/db/src/session/runner/llm.ts` | New durable runner with V2 messages, `compactIfNeeded()`, `recoverOverflow()` |
| **projector.ts** | `packages/db/src/session/projector.ts` | V1→V2 event projection: maps V1 `MessageUpdated`, `MessageParts` events to V2 |
| **message-updater.ts** | `packages/db/src/session/message-updater.ts` | Handles V2 event projection: `Compaction.Ended` creates V2 Compaction message |
| **message.ts** | `packages/db/src/session/message.ts` | V2 `SessionMessage` types: User, Assistant, Compaction, ToolCall, ToolResult, etc. |
| **history.ts** | `packages/db/src/session/history.ts` | V2 session history loading: `load()`, `loadForRunner()`, `entriesForRunner()`, `messageRows()` |
| **session.ts** (db) | `packages/db/src/session/session.ts` | V1 session operations: `updateMessage()`, `updatePart()`, `messages()` — reads `MessageTable` + `PartTable` |
| **task.ts** | `packages/server/src/session/task.ts` | TaskTool implementation for sub-agent spawning via `oicall_read_session` + `oicall_open_session` |

---

## What Was Investigated

### Done:
1. Identified the exact malformed JSON payload
2. Traced the V1 compaction flow: `prompt.ts:1247` → `compaction.create()` → `compaction.process()` → LLM call → summary storage
3. Traced the V2 compaction flow: `runner/llm.ts:228` → `compactIfNeeded()` → event publishing → V2 Compaction message
4. Read and understood V1 types (`WithParts`, `CompactionPart`, `User`, `Assistant`) in `message-v2.ts`
5. Read and understood V2 types (`SessionMessage.User`, `SessionMessage.Compaction`, etc.) in `message.ts`
6. Compared V1→LLM conversion (`toModelMessagesEffect`) vs V2→LLM conversion (`toLLMMessages`) — V2 handles compaction properly with `<conversation-checkpoint>`, V1 replaces with "What did we do so far?"
7. Investigated the V1→V2 projector (`projector.ts`) and event handling (`message-updater.ts`)
8. Investigated `filterCompacted()` logic for post-compaction message reordering

### Not yet resolved:
1. **Exact code path** where the raw V1 `WithParts` JSON leaks to the LLM
2. Whether this is a V1 path issue or a V2/V1 interaction issue
3. Whether the fix should be in `toModelMessagesEffect()` (V1), `filterCompacted()`, or the projector
4. Whether the bug occurs only with `experimentalEventSystem` enabled

### Failed attempts:
- Sub-agent (explore) hit `Failed query: insert into "session" ...` SQL error when trying to read session data — suggests the sub-agent system itself has DB session creation issues
- Manual grep searches found 100+ compaction-related patterns across packages

---

## Key Questions Still Open

1. **Which runner is active?** Is the build agent using the V1 prompt loop (`prompt.ts`) or the V2 runner (`runner/llm.ts`)? The malformed JSON has V1 format, suggesting V1 path.
2. **Can `toModelMessagesEffect()` ever produce a raw `WithParts` JSON?** It converts to `UIMessage[]` → `ModelMessage[]`, which should strip all V1 metadata. If it doesn't, that's the bug.
3. **Does `filterCompacted()` modify messages in a way that leaks raw JSON?** It only reorders/slices arrays, doesn't modify individual messages.
4. **Is the projector creating malformed V2 Compaction messages?** If the `Compaction.Ended` event fires with empty `summary` or `recent`, the V2 Compaction message could have empty content, but wouldn't produce the V1 JSON format.
5. **Is there a subtask/spawn race?** The TaskTool spawns a new agent session. If the compaction task runs simultaneously with a subtask, messages could get mixed up.

---

## Next Steps to Fix

1. **Identify the exact leak point**: Add logging or trace through the V1 compaction post-processing to see where the raw `WithParts` escapes.
2. **Candidate fix A** — `toModelMessagesEffect()`: When a user message has a compaction part and also has text parts, merge them properly. Currently the compaction part adds a separate "What did we do so far?" text, but other text parts should be preserved.
3. **Candidate fix B** — `filterCompacted()`: After reordering, ensure compaction user messages are converted to proper format before being stored in `msgs`.
4. **Candidate fix C** — Prevent raw V1 `WithParts` from ever reaching the LLM stream function.
5. **Verification**: Manual test with a session that triggers compaction, verify the agent receives proper text content, not raw JSON.

---

## Database Layout

**V1 tables**: `MessageTable` (id, session_id, time_created, data), `PartTable` (id, message_id, session_id, time_created, type, data)
- `data` column holds JSON of V1 types

**V2 tables**: `SessionMessageTable` (id, session_id, type, seq, time_created, data), `SessionTable`, `SessionEventTable`
- `data` column holds JSON of `SessionMessage.Message` tagged union
- `type` column is the message type discriminator (user, assistant, tool-call, tool-result, compaction, agent-switched, context-epoch, system)

**SessionEventTable**: Stores V1 and V2 events for projection. Event types:
- V1: `SessionV1.Event.MessageUpdated`, `SessionV1.Event.MessageParts`
- V2: `SessionEvent.Compaction.Started`, `SessionEvent.Compaction.Ended`, `SessionEvent.StepStarted`, `SessionEvent.ToolResult`, `SessionEvent.MessageCreated`

---

## Environment

- **Project**: DiveeOI at `/home/aboood/Documents/Projects/DiveeOI`
- **Stack**: TypeScript 5.8, Bun 1.3.14, Effect-TS 4.0.0-beta.74, SQLite via Drizzle ORM
- **AI SDK**: Vercel AI SDK (`convertToModelMessages` used in V1 path)
- **LLM provider**: `opencode/deepseek-v4-flash-free` (the model running *this session itself*)
- **Fork**: Fork of [OpenCode](https://github.com/anomalyco/opencode) — TUI removed, web-only SPA
