# DiveeOI Overhaul Plan

> 5-phase implementation plan for TOON format, latency optimization, compaction fix, burst limiting, and pre-bundled MCPs.

---

## Phase 0: TOON Format for Tools & Constraint Prompts

**Goal**: Replace JSON serialization of tool schemas, tool calls, and tool responses with a compact structured text format. Also migrate constraint prompts (permission rules, config) from ad-hoc text/JSON to TOON.

### 0.1 — TOON Format Specification

TOON is a line-delimited key:value format designed for LLM token efficiency:

```
Tool: Bash
  Desc: Run shell commands
  Params:
    command: string   "The shell command to execute"
    description: string?  "Human-readable description"
    timeout: integer? 5000  "Timeout in ms"
    workdir: string?  "Working directory path"
```

Key rules:
- Sections are indented with 2 spaces
- `Key: Value` format — no quotes on values unless they contain `:`
- `Key: Type? Default  "Description"` for parameters
- `Key: Type   "Description"` for required parameters (no default)
- Types: `string`, `integer`, `number`, `boolean`, `object`, `array`, `any`
- Literal types: `"value1" | "value2"`
- Arrays: `Type[]`
- Nested objects: indented sub-sections
- Multi-line values: `|` prefix with indented continuation
- Empty sections are omitted entirely

### 0.2 — Tool Schema Serialization (`packages/server/src/tool/tool.ts`)

- Add `toonSchema()` function to `Def` that serializes `parameters` (Effect Schema) → TOON string
- Add `toonCall(args)` function that serializes tool call args → TOON string
- Add `toonResult(result)` function that serializes `ExecuteResult` → TOON string
- Add config flag `tool.format` in `Config.Service` defaulting to `"toon"` (fallback `"json"`)
- Inject serialized TOON strings into the `description` field of AI SDK `Tool` objects (see `define()` wrapper in `tool.ts:48-65`)

**Key integration point** (`tool.ts:48-65`, `wrap()` function):
```ts
// Currently: description stays as-is, parameters are Effect Schema
// After: inject TOON into description, strip from inputSchema when format=toon
toolInfo.description = [
  toolInfo.description || " ",
  "",
  "```schema",
  toonSchema(toolInfo.parameters),
  "```",
].join("\n")
// Set parameters to a minimal schema accepted by Effect decode
toolInfo.parameters = minimalSchema  // Effect.Schema stops enforcing here
```

**Important**: Do NOT modify Effect Schema decoding — keep `decodeUnknownEffect` as-is for validation. TOON is for the LLM's *view* of the schema only.

### 0.3 — Tool Call TOON Input

- In the `execute` wrapper (`tool.ts:39-57`), args arrive from LLM as JSON but the prompt description is now TOON
- No code change required — the LLM receives TOON descriptions but still emits JSON tool calls
- **Long-term**: Support TOON-encoded tool calls (LLM emits TOON instead of JSON) via a native format flag on the provider

### 0.4 — Tool Response TOON

- In `truncate.ts`, the output preview already limits content
- Add `toonResult(result: ExecuteResult)` that formats the output as:
```
Title: search results
Output:
  | Found 3 matching files
  | src/index.ts:10 — config
  | src/main.ts:42 — run loop
Attachments: (1)
  | [image/png: screenshot.png]
```
- Use this instead of JSON result in the tool response part when `format=toon`
- **Location**: `packages/server/src/tool/truncate.ts` output path, or `packages/server/src/processor.ts` where tool result messages are built

### 0.5 — Constraint Prompt TOON Migration

Constraint prompts are JSON rulesets that go into the system prompt. Find all:

1. **Permission rules** (`packages/server/src/permission/index.ts:197-208`, `fromConfig()`)
   - Current format in prompts: `Rule: { permission: "bash", action: "allow", pattern: "*" }`
   - TOON format:
     ```
     Permission:
       bash: allow *
       edit: deny /etc/*
       read: ask /var/*
     ```

2. **Tool output limits** (`packages/server/src/tool/truncate.ts`)
   - Current: `cfg?.tool_output?.max_lines` / `cfg?.tool_output?.max_bytes`
   - TOON in system prompt:
     ```
     Output Limits:
       Max Lines: 2000
       Max Bytes: 51200
     ```

3. **MCP server listing** — current format in system prompt is verbose JSON
   - TOON:
     ```
     MCP Servers:
       filesystem: connected (12 tools)
     ```

### Files Changed in Phase 0

| File | Change |
|---|---|
| `packages/server/src/tool/tool.ts` | Add `toonSchema()`, inject TOON into description |
| `packages/server/src/tool/toon.ts` (new) | TOON serializer/deserializer library |
| `packages/server/src/tool/truncate.ts` | Add `toonResult()` option |
| `packages/server/src/config/config.ts` | Add `tool.format` config key |
| `packages/server/src/permission/index.ts` | Add `toonRules()` for TOON-format permission display |
| `packages/db/src/session/compaction.ts` | Fix `SUMMARY_TEMPLATE` to reject TOON in summaries (metadata only) |
| `packages/server/src/system/prompt.ts` (estimate) | Wire TOON format into system prompt generation |

### Edge Cases

- **Effect Schema with complex types**: `Schema.Union`, `Schema.Array`, `Schema.Record` need recursive TOON serialization
- **Empty parameters**: `{}` → omit `Parameters:` section entirely
- **Compatibility**: Old sessions with JSON descriptions must continue working for the duration of existing conversations
- **Performance**: TOON serialization must be <1ms per tool — use string builder, no intermediate AST

---

## Phase 1: Latency Optimization (3–6s First-Token)

**Goal**: Reduce first-token latency from current 3–6s to sub-500ms on repeated requests and sub-2s on cold start.

### Root Cause Analysis (from `packages/server/src/session/llm/`)

The LLM pipeline for each request:
1. `llm.ts:85-150` — `LLM.run()`:
   - Resolves provider (DB query: `provider.getLanguage`)
   - Resolves config (DB: `config.get()`)
   - Resolves provider info (DB: `provider.getProvider`)
   - Resolves auth (DB: `auth.get`)
   - `LLMRequestPrep.prepare()` — system prompt build, message transform
   - AI SDK `streamText()` call — network round-trip to model provider
2. Each of the DB queries is a SQLite read — fast individually but chain latency adds up
3. AI SDK `streamText()` establishes a new HTTP connection every request — no keep-alive optimization

### 1.1 — Pre-Warm LLM Client Connection

- **File**: `packages/server/src/session/llm.ts`
- Add a connection pool per (providerID × baseURL):
  ```ts
  interface PoolEntry {
    client: LLMClientShape
    lastUsed: number
    expires: number
  }
  const pool = new Map<string, PoolEntry>()
  ```
- Reuse `@diveeoi/llm/route` clients for the native runtime path (already available via `LLMClient.Service`)
- For AI SDK path: create a shared `fetch` function with keep-alive:
  ```ts
  // Use node:http.Agent with keepAlive: true
  const http = require("node:http")
  const agent = new http.Agent({ keepAlive: true, maxSockets: 4 })
  ```
- **Edge case**: Connection expiry after 30s idle — lazy reconnect
- **Edge case**: OAuth tokens expire mid-pool — check `auth.get()` TTL before reuse

### 1.2 — Cached Provider/Config Resolution

- **File**: `packages/server/src/session/llm.ts:96-103`
- Wrap the four parallel DB queries (`getLanguage`, `get`, `getProvider`, `auth.get`) with `Effect.cached` keyed on `modelID + providerID + sessionID`
- Cache TTL: 5s for config, 60s for provider/auth
- Invalidate on config change events (already published as `EventV2`)

### 1.3 — Speculative Token Generation / Prompt Caching

- **File**: `packages/server/src/session/llm.ts` + `packages/server/src/session/llm/request.ts`
- The system prompt is the same across requests within a session (agent prompt + system prompt). Cache it:
  - Compute `Cache-Control` headers per-provider (Anthropic: `anthropic-beta`, OpenAI: `prompt_cache` key prefix)
  - Before the first LLM call, construct the full system prompt once and store as `prepared.system.join("\n")`

### 1.4 — Native Runtime as Default

- **File**: `packages/server/src/session/llm/native-runtime.ts`
- Currently opt-in via `OPENCODE_EXPERIMENTAL_NATIVE_LLM=true`
- Change to default-on for supported providers (OpenAI, opencode, Anthropic with API key)
- The native runtime bypasses AI SDK's `streamText()` setup overhead (JSON serialization, validation)

### 1.5 — Async Session Start

- **File**: `packages/server/src/main.ts` (or `packages/server/src/session/bootstrap.ts`)
- When the server starts or a session is created, pre-resolve the model, provider, and auth for the session's configured model
- Store in a `SessionStartCache` so the first LLM call doesn't wait for resolution

### Files Changed in Phase 1

| File | Change |
|---|---|
| `packages/server/src/session/llm.ts` | Connection pool, Effect.cached wrappers, agent keep-alive |
| `packages/server/src/session/llm/request.ts` | Cache system prompt construction |
| `packages/server/src/session/llm/native-runtime.ts` | Flip default to enabled; add agent reuse |
| `packages/server/src/session/llm/ai-sdk.ts` | Add keep-alive HTTP agent |
| `packages/server/src/session/bootstrap.ts` (estimate) | Pre-resolve session dependencies |
| `packages/server/src/config/config.ts` | Add `llm.connectionPool` config schema |

### Metrics to Track

- `llm.first_token_ms` — histogram in spans (already using Effect withSpan)
- `llm.pool_hit` — counter for connection pool hits vs misses
- `llm.cache_read` / `llm.cache_write` — prompt cache effectiveness

---

## Phase 2: Compaction Anchored Memory Fix

**Goal**: The compaction system currently loses nuanced context — tool call results, user preferences, specific error messages. Make the summary anchor dense and preserve critical data.

### Current Analysis

- **`packages/db/src/session/compaction.ts`**: `SUMMARY_TEMPLATE` produces a structured summary with sections (Goal, Progress, etc.). The `buildPrompt()` feeds the previous summary + new conversation text and asks the LLM to update it.
- **`packages/server/src/session/compaction.ts`**: Orchestrates the full compaction cycle — selects which messages to compact, invokes the DB-layer LLM call, handles auto-continue.
- **`select()` function** (`server/compaction.ts:198-249`) picks head (to compact) and tail (to keep) based on budget
- **`serialize()` function** (`db/compaction.ts`) converts messages to text for summary — **tool output is truncated** at `TOOL_OUTPUT_MAX_CHARS = 2000` chars

### Why Context Is Lost

1. **Tool call truncation**: `truncate(value)` in `db/compaction.ts:63` cuts tool output to 2000 chars before feeding to the summarizer
2. **One-pass summarization**: The LLM gets `modelMessages` (after `stripMedia: true`) + a single prompt — it cannot review the full conversation
3. **No tool-call enumeration in template**: The `SUMMARY_TEMPLATE` has no section for tool calls, so the summarizer naturally drops them
4. **Lossy tail selection**: The `select()` function estimates token counts and may drop the middle of the conversation entirely

### 2.1 — Add Tool Call Log Section to Summary Template

- **File**: `packages/db/src/session/compaction.ts:100-112` (`SUMMARY_TEMPLATE`)
- Add a new mandatory section after `## Relevant Files`:
  ```markdown
  ## Tool Calls
  - [tool name]: [number of calls], [key operations]
  ```

- Update `buildPrompt()` (`db/compaction.ts:166-173`) to explicitly instruct:
  ```
  For the Tool Calls section, list every distinct tool used, how many times,
  and the most significant operations. Do not omit tool calls.
  ```

### 2.2 — Preserve Tool Call Critical Data in Serialization

- **File**: `packages/db/src/session/compaction.ts:76-93` (`serialize()` function)
- Currently `truncate()` is applied unconditionally to all tool content
- Change: extract the first 500 chars of tool **output** AND the last 500 chars (head+tail instead of just head)
  ```ts
  const truncateHeadTail = (value: string) => {
    if (value.length <= TOOL_OUTPUT_MAX_CHARS) return value
    const head = value.slice(0, TOOL_OUTPUT_MAX_CHARS / 2)
    const tail = value.slice(-TOOL_OUTPUT_MAX_CHARS / 2)
    return `${head}\n...[${value.length - TOOL_OUTPUT_MAX_CHARS} bytes truncated]...\n${tail}`
  }
  ```
- Also: serialize tool **name** and **duration** (from `part.state.time`) in addition to input/output
  ```ts
  `[Tool result - ${part.name} (${duration}ms)]: ${truncateHeadTail(...)}`
  ```

### 2.3 — Enforce Multi-Pass Summary Verification

- **File**: `packages/server/src/session/compaction.ts:410-425`
- After the initial summary generation, add a verification step:
  ```ts
  // If the summary is very short (<100 chars for 20+ messages), re-run
  if (summaryText(result)!.length < 100 && input.messages.length > 20) {
    // Re-summarize with more explicit instructions
    yield* processor.process({ ...input, system: ["The previous summary was too brief. Include more detail."] })
  }
  ```
- **Edge case**: Don't loop more than 2 times to avoid unbounded cost

### 2.4 — Fix Compaction Prompt to Preserve Critical Sections

- **File**: `packages/db/src/session/compaction.ts:166-173` (`buildPrompt`)
- Current prompt:
  ```
  Update the anchored summary below using the conversation history above.
  Preserve still-true details, remove stale details, and merge in the new facts.
  ```
- Replace with:
  ```
  Update the anchored summary below using the conversation history above.
  Rules:
  - Preserve every file path, command, error string, and identifier.
  - Preserve tool names and key results from tool calls.
  - Preserve user preferences, constraints, and decisions.
  - Remove only information that is provably stale (e.g. a resolved issue).
  - If uncertain whether a detail is still relevant, keep it.
  - The "Tool Calls" section must list every tool used in the new conversation span.
  - Minimum summary length: 300 characters for sessions with 10+ messages.
  - Minimum summary length for sessions with 20+ messages: 500 characters.
  ```

### 2.5 — Protect Against Catastrophic Forgetting

- **File**: `packages/server/src/session/compaction.ts:410-425`
- After compaction, emit a synthetic user message (not just the auto-continue) that re-injects the anchor:
  ```ts
  // Already in auto-continue path (lines 495-525)
  // Modify the continue text to include a condensed anchor
  const compacted = yield* session.messages({ sessionID: input.sessionID })
  const lastCompaction = compacted.reverse().find(m => m.info.summary)
  if (lastCompaction?.info.summary) {
    text = `[Conversation compacted. Context anchor below.]\n${lastCompaction.parts.filter(p => p.type === "text").map(p => p.text).join("\n")}\n\nContinue.`
  }
  ```
- **Warning**: This increases prompt length. Only emit when the summary is <2000 chars.

### Files Changed in Phase 2

| File | Change |
|---|---|
| `packages/db/src/session/compaction.ts` | Add Tool Calls section to SUMMARY_TEMPLATE, head+tail truncation, stricter buildPrompt |
| `packages/server/src/session/compaction.ts` | Multi-pass verification, anchor re-injection, enforce min length |

### Edge Cases

- **Empty summary**: LLM fails to generate → fallback to "Session compacted, no summary generated"
- **Compaction during compaction**: Guard against recursive compaction (check `message.type === "compaction"` in `serialize()` — already done)
- **Very long sessions (300+ messages)**: Preserve proportionally — 50 chars per 10 messages minimum
- **Model lacks context for summary**: The `select()` function already ensures head fits in context. If it doesn't, `compact` result is returned.

---

## Phase 3: Burst Output Limiting (RTK-Style)

**Goal**: Prevent tools (especially `bash`, `read`, `grep`) from flooding the LLM context window with huge output. Current truncation (`truncate.ts`) is reactive (cuts after full capture). Add proactive burst limiting that streams output and cuts mid-flight.

### 3.1 — Current State

- `truncate.ts` has `output()` function that checks lines/bytes *after* the tool completes
- No mechanism to stop a running tool mid-execution when output exceeds limits
- `MAX_LINES = 2000`, `MAX_BYTES = 50 * 1024` — hardcoded defaults, overridable via `tool_output` config

### 3.2 — Streaming Output Interceptor

- **File**: `packages/server/src/tool/stream-limiter.ts` (new)
```ts
interface StreamLimiterOptions {
  maxLines: number
  maxBytes: number
  abort: AbortSignal
}
class StreamLimiter {
  private lines = 0
  private bytes = 0
  private exceeded = false

  write(chunk: string): boolean {
    // Returns false if limit exceeded — caller should stop
    if (this.exceeded) return false
    const newLines = chunk.split("\n").length - 1
    const newBytes = Buffer.byteLength(chunk, "utf-8")
    if (this.lines + newLines > this.maxLines || this.bytes + newBytes > this.maxBytes) {
      this.exceeded = true
      return false
    }
    this.lines += newLines
    this.bytes += newBytes
    return true
  }
}
```

### 3.3 — Integration into Tool Execution

- **File**: `packages/server/src/tool/tool.ts` — wrap `execute()` with limiter:
```ts
// In the wrap() function, after decode:
const limiter = new StreamLimiter({
  maxLines: limits.maxLines,
  maxBytes: limits.maxBytes,
  abort: ctx.abort,
})
const result = yield* Effect.withAbort(execute(decoded, ctx), ctx.abort)
// If limiter was exceeded, truncate result
```

- **File**: `packages/server/src/tool/bash.ts` (estimate) — the bash tool produces the most output. Integrate limiter:
```ts
// Instead of collecting all output then truncating:
const output = yield* bash.run({
  command: args.command,
  limiter,  // pass StreamLimiter
  // Returns { output: string, truncated: boolean }
})
```

### 3.4 — Abort Signal Propagation

- **File**: `packages/server/src/tool/bash.ts` (or wherever bash execution lives)
- When burst limit is hit, send `SIGTERM` to the child process
- On capture, immediately set `ctx.abort` to `AbortController.abort()`
- **File**: bash execution in `packages/db/src/tool/` (18 tool files)
- Check if `packages/db/src/tool/bash.ts` uses `ChildProcessSpawner` or direct `spawn`

### 3.5 — Config Schema for Burst Limits

- **File**: `packages/server/src/config/config.ts` — already has `tool_output.max_lines` / `max_bytes`
- Add: `tool_output.burst_strategy: "truncate" | "abort"` (default: `"truncate"` — existing behavior)
- Add: `tool_output.burst_action: "warn" | "interrupt"` — if `"interrupt"`, kill the tool process on overflow

### Files Changed in Phase 3

| File | Change |
|---|---|
| `packages/server/src/tool/stream-limiter.ts` (new) | Burst limiter class |
| `packages/server/src/tool/tool.ts` | Wire limiter in `wrap()` |
| `packages/server/src/tool/bash.ts` (estimate) | Integrate limiter into bash process |
| `packages/db/src/tool/bash.ts` (estimate) | Add limiter parameter to low-level execution |
| `packages/server/src/config/config.ts` | Add burst config fields |
| `packages/server/src/tool/truncate.ts` | Exposure limits for limiter |

### Edge Cases

- **Abort race condition**: Output that came in just before the abort signal may exceed limit — that's acceptable (<10% overage)
- **Limiter overhead**: Check on every chunk write — use integer comparison, no regex
- **Tools that must not be interrupted**: `skill`, `task` (subagent) — mark with `burstable: false` in their tool definition
- **Default behavior unchanged**: `burst_strategy: "truncate"` for backward compatibility

---

## Phase 4: Bundled Built-in Tools (ctx7 + context-mode)

**Goal**: Bundle `@upstash/context7-tools-ai-sdk` (direct SDK import) and `context-mode` (npm MCP server) as auto-added built-in tools with configurable settings, performance caps, graceful degradation, and usage tracking.

### 4.1 — Strategy Change from Plan v1

- **ctx7**: `npx ctx7 setup --opencode` (interactive, hangs in non-TTY) replaced with direct `@upstash/context7-tools-ai-sdk` import — tools injected into `ToolRegistry` as `Tool.Def` objects; no MCP server needed
- **context-mode**: `context-mode` npm package installed as dependency, auto-registered as built-in MCP stdio client (path resolved from `node_modules`); merged into MCP config programmatically before user config so `{ enabled: false }` overrides it

### 4.2 — Config Schema (`packages/db/src/v1/config/config.ts`)

Added `builtin` struct under `ConfigV1.Info`:

```ts
builtin: Schema.optional(Schema.Struct({
  ctx7: Schema.optional(Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
    api_key: Schema.optional(Schema.String),
    max_docs: Schema.optional(PositiveInt),
    max_tokens: Schema.optional(PositiveInt),
  })),
  context_mode: Schema.optional(Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
  })),
}))
```

### 4.3 — ctx7 Integration (`packages/server/src/setup/ctx7.ts`)

- Rewrote from npx-spawn to `@upstash/context7-tools-ai-sdk` dynamic import
- `getCtx7Defs()`: Returns `Tool.Def[]` for injection into `ToolRegistry`
  - Checks `DIVEEOI_CTX7_DISABLED` env var, `builtin.ctx7.enabled`, and `UPSTASH_CONTEXT7_API_KEY`
  - Dynamic import with `Effect.catch` — graceful failure if package missing
  - Wraps each SDK tool in `Effect.catchAll` — falls back to web search on failure
  - Each tool call logged via `EventV2Bridge` for usage tracking
- `checkCtx7Update()`: Background fiber that checks `npm outdated @upstash/context7-tools-ai-sdk` at startup, logs notice if update available

### 4.4 — context-mode MCP (`packages/server/src/setup/context-mode.ts`)

- `resolveContextModeMCP()`: Returns `Record<string, ConfigMCPV1.Info>` entry for the built-in MCP server
  - Checks `DIVEEOI_CONTEXT_MODE_DISABLED` env var and `builtin.context_mode.enabled`
  - Resolves path via `createRequire(import.meta.url).resolve("context-mode")`
  - Returns undefined (no-op) if package not found — server starts cleanly
- Hooked into `packages/server/src/mcp/index.ts` state init — built-in entries merged before user config entries
- User can override or disable via `builtin.context_mode.enabled = false` in `diveeoi.jsonc`

### 4.5 — Tool Registry Integration (`packages/server/src/tool/registry.ts`)

- Added `getCtx7Defs()` call inside `InstanceState.make` closure
- Returned `Tool.Def[]` spread into the `builtin` array alongside shell/read/edit/etc.
- `Effect.catch` wraps the call — ctx7 tools silently absent if disabled/unavailable

### 4.6 — MCP Layer Hook (`packages/server/src/mcp/index.ts`)

- In `InstanceState.make` state init, after reading `cfg.mcp`, inject built-in MCP entries
- `resolveContextModeMCP()` called with `Effect.catch` — failure handled gracefully
- Built-in entries only added if key not already in user config (user config wins)

### 4.7 — Env Var Overrides

- `DIVEEOI_CTX7_DISABLED=1` — hard disable ctx7 before config is read
- `DIVEEOI_CONTEXT_MODE_DISABLED=1` — hard disable context-mode before config is read
- `UPSTASH_CONTEXT7_API_KEY` — API key for ctx7 (falls back to config)

### 4.8 — Dependencies

- `@upstash/context7-tools-ai-sdk: latest` — AI SDK tools for Context7
- `context-mode: latest` — MCP server for conversation compression

### Edge Cases

- **Missing package**: Dynamic imports and `require.resolve` wrapped in `Effect.catch` — no crash, logged as warning
- **No API key for ctx7**: Returns empty array — tools silently absent without error
- **context-mode fails to start**: MCP `create()` already handles this — returns `status: "failed"`, no crash
- **User config override**: User's `builtin.ctx7.enabled: false` or `builtin.context_mode.enabled: false` respected
- **User MCP conflict**: If user already has `context-mode` in their MCP config, built-in entry is skipped (user config wins)
- **Update checking**: `npm outdated` runs in background fiber with 10s timeout — failure silently ignored

---

## Timeline & Dependencies

```
Phase 0 (TOON format)            ── starts immediately
Phase 1 (latency)                ── parallel with Phase 0 (different files)
Phase 2 (compaction fix)         ── needs Phase 0 (TOON in summary)
Phase 3 (burst limiting)         ── parallel with Phase 0-2
Phase 4 (MCP bundling)           ── parallel with everything
```

---

## Rollback Strategy

Each phase must be independently reversible:

- **Phase 0**: Set `tool.format: "json"` in config — restores all JSON behavior within one restart
- **Phase 1**: Remove connection pool by flipping env flag — restores default behavior
- **Phase 2**: Revert summary template to original — loses verbose summaries but compaction still works
- **Phase 3**: Set `burst_strategy: "truncate"` — restores pre-Phase-3 behavior
- **Phase 4**: Comment out MCP entries in config — servers not loaded

---

## Verification Before Each Phase Ship

1. `bun turbo typecheck` — zero errors
2. Existing tests pass (`bun test` in affected packages)
3. Manual smoke test: start server, send a message, verify no regressions
4. For Phase 0: System prompt contains TOON, not JSON for tool descriptions
5. For Phase 1: First-token latency drops measurably (`llm.first_token_ms` span)
6. For Phase 2: Compaction summary includes Tool Calls section and tool output details
7. For Phase 3: Bash tool with 100,000 lines of output is cleanly truncated or aborted
8. For Phase 4: context-mode MCP appears in `mcp status` as connected; ctx7 setup completes on first run
