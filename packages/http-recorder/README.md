# @diveeoi/http-recorder

Effect `HttpClient` cassette recorder used by tests. Replay is the default; recording is `RECORD=1` with an allowlisted provider key set. Produces deterministic `pretty-printed JSON` cassettes with ordered `{request,response}` interactions (one file handles tool-loop multi-round flows).

## What it does

- Wraps `HttpClient.HttpClient` via `HttpRecorder.http` (from `src/effect.ts`) into a `Layer` that either replays a stored cassette (cursor-driven) or records a new one through the real transport.
- Binary response bodies (AWS `event-stream`, image bytes, anything not `text/*` / JSON / XML / SVG) are stored as base64 `bodyEncoding:"base64"`; textual bodies stay plain.
- Matching walks the cassette in record order (the Nth runtime request matches the Nth recorded interaction) and validates `method + URL + allow-listed headers + canonical JSON body`. This covers tool-loop history growth and retry/polling byte-identical successives uniformly.
- Redaction (`src/redaction.ts` / `redactor.ts`) strips `Authorization`, `x-api-key`, `sk-*` etc. before writing.
- `HttpRecorder.socket` wraps WebSocket transports the same way (`src/socket.ts`).
- Deterministic scripting counterpart without disk: `scriptedResponses` from `test/lib/http.ts`.

## Usage

```ts
import { HttpRecorder } from "@diveeoi/http-recorder"

const layer = HttpRecorder.http.withCassette("fixtures/anthropic.basic")
  .pipe(Layer.provide(MyRealClientLayer))

await Effect.runPromise(MyOp.pipe(Effect.provide(layer)))
```

Cassettes carry `CassetteMetadata { provider, protocol, tags, recordedAt }` for search. Matching can be filtered without deleting cassettes:

```bash
RECORD=1 bun test                          # record all that would otherwise replay
RECORDED_PROVIDER=openai                   # only provider:openai cases
RECORDED_PREFIX=openai-chat                # only cassette group with that prefix
RECORDED_TAGS=tool                         # requires all listed tags
RECORDED_TEST="streams text"               # test name / kebab-id / path
```

Filters compose and apply in both replay and record so re-recording is targeted.

## Conventions

- One cassette per `recordedTests({ prefix: "provider-protocol", requires: ["API_KEY_ENV"] }).effect("scenario" -> gen)` scenario. Keep stable cassettes unchanged unless their request shape intentionally changes — regenerate only that file.
- Store the cassette as `cassette.json` under `cassettes/<prefix>/<scenario>.json` (pretty-printed, `JSON.stringify` with 2-space indent).
- For multi-interaction diffs the corridor matters — do not sort interactions.

## Package note

Test-only. Listed as `devDependency` everywhere — never import it in production code (enforced by `eslint` restricted-imports in `api` etc.).

## Scripts

```bash
bun --cwd packages/http-recorder run typecheck
bun --cwd packages/http-recorder run test
```
