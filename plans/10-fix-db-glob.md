# Plan 10 — Fix `packages/db/src/tool/glob.ts`

## Errors (2)

- `glob.ts(132,45): TS2504: Type 'ReadableStream<Uint8Array<ArrayBuffer>>' must have a '[Symbol.asyncIterator]()' method that returns an async iterator.`
- `glob.ts(135,45): TS2504` (same)

## Root cause

`Bun.spawn(...)` at ~line 126; `for await (const chunk of proc.stdout)` at lines 132 and 135.
`proc.stdout` is typed `ReadableStream<Uint8Array>` and the TS lib's `ReadableStream` type
(Bun's, in bun-types) does not expose `[Symbol.asyncIterator]` in this configuration.

## Prescribed fix (pick the cleanest after reading the file)

Option A (minimal):
```ts
for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
```
Option B (no cast — reader loop):
```ts
const reader = proc.stdout.getReader()
try {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // process value (Uint8Array)
  }
} finally {
  reader.releaseLock()
}
```
Option C: if the chunk is only used as text, `const out = await Bun.readableStreamToText(proc.stdout)`.

Choose the option that requires the least restructuring of the existing loop bodies (lines
~130-140). Keep behavior identical (chunks are appended to a buffer or processed incrementally —
match what the code already does). Do NOT change the spawn options or error handling.

## Verify

- `grep -n "proc.stdout" packages/db/src/tool/glob.ts` — no `for await ... proc.stdout` remaining without a fix.
- Do NOT run typecheck.
