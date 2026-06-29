# HTTP Recorder Package (@diveeoi/http-recorder)

Record and replay Effect HTTP client traffic with deterministic cassettes. Used by test suites (not production).

- **`HttpRecorder.http`** (from `src/effect.ts`) — wraps an `HttpClient` in a recording/replaying layer. Replay is the default; recording is opt-in via `RECORD=true` env var.
- **Cassette format** — ordered array of `{ request, response }` interactions stored as pretty-printed JSON. Multi-step flows (tool loops, retries, polling) record into a single file with an internal cursor for replay.
- **Binary bodies** — responses with binary content types (e.g. AWS event-stream frames) are stored as base64 with `bodyEncoding: "base64"`. Textual types (`text/*`, JSON, XML, JS, forms, YAML, SVG) are stored as plain text.
- **Matching strategy** — replay walks the cassette in record order via cursor: the Nth runtime request matches the Nth recorded interaction. Validation compares method, URL, allow-listed headers, and canonical JSON body.
- **`HttpRecorder.socket`** (from `src/socket.ts`) — WebSocket recording via `HttpRecorder.socket`.
- **Redaction** (`src/redaction.ts`, `src/redactor.ts`) — additive redaction policy for removing sensitive data (API keys, tokens) from recorded cassettes.
- **`matching.ts`** — request matching logic (`RequestMatcher`).
- **`schema.ts`** — Schema codecs for cassette serialization.
- **`types.ts`** — `CassetteMetadata`, `RecorderOptions`, `RedactOptions`, `RequestMatcher`, `RequestSnapshot` types.
- **Only a test dependency** — listed as devDependency in consuming packages. Not part of the production server or app.
