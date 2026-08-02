# Plan 18 — Fix tests: `schema-decoding.test.ts` (5) + `session-schema.test.ts` (1)

Ownership: BOTH files are yours. Touch nothing else.

## File 1: `packages/server/test/session/schema-decoding.test.ts` — 5 errors

### Errors (all identical)
- `46,35` TS2769 · `77,35` TS2769 · `96,35` TS2769 · `135,35` TS2769 · `149,35` TS2769 — No overload matches this call.

### Root cause (VERIFIED against installed effect@4.0.0-beta.74)
In beta.74 `Schema.decodeUnknownSync` is CURRIED:
```
Schema.decodeUnknownSync(schema)(value)   // correct in beta.74
Schema.decodeUnknownSync(schema, value)   // wrong — causes TS2769
```
The doc examples in `node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/Schema.d.ts`
(lines ~69, ~1190, ~2703) show the curried form: `Schema.decodeUnknownSync(NumberFromString)("42")`.
Line 1203: `export declare const decodeUnknownSync: typeof Parser.decodeUnknownSync;`

### Fix
1. Read the helper at line ~30 of the test (it wraps `Schema.decodeUnknownSync(...)`).
2. Change the call to the curried form: `Schema.decodeUnknownSync(schema)(value)`.
3. Since the helper centralizes the call, ALL 5 error sites (46/77/96/135/149) resolve from
   the single helper change. If the helper is not the caller, fix each site the same way.
4. Do not change the schemas or the test expectations.

## File 2: `packages/server/test/session/session-schema.test.ts` — 1 error

### Error
- `28,3` TS1360: the fixture object does not satisfy the Session type:
  `{ id, slug, projectID, directory, title: string, titleAttempted: number, version: string, time: { ... }, ... 11 more ..., revert?: ... }`
  The fixture currently sets `workspaceID: undefined, parentID: undefined, summary: undefined,
  ... 7 more ..., revert: undefined` — missing REQUIRED fields `title`, `titleAttempted`,
  `version`, `time`, plus the other required members of "... 11 more ...".

### Fix
1. Read the Session schema the test imports (follow the import at the top of the file —
   likely from `src/session/schema.ts` or `@diveeoi/db/v1/session`) and enumerate ALL required
   fields with their exact types (`title: string`, `titleAttempted: number`, `version: string`,
   `time: { created: number }`-style, and the rest — including any `model`, `agent`, `parts`,
   `messageCount`, `tokens`, etc.).
2. Complete the fixture at line 28 with every required field using realistic values.
3. Remove the explicit `: undefined` entries for fields that are OPTIONAL in the schema
   (or keep them only where the schema truly requires `| undefined`).
4. Match the schema's exact field names — TS1360 lists every missing/extra field; read the
   full error by checking the schema type, don't guess.

## Verify (both files)
- `grep -n "decodeUnknownSync" test/session/schema-decoding.test.ts` — all calls are curried.
- Re-read the fixture against the imported schema type — every required field present.
- Do NOT run typecheck.
