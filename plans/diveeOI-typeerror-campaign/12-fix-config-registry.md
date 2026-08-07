# Plan 12 — Fix `packages/server/src/config/registry.ts`

## Errors (4)

- `src/config/registry.ts(5,59): TS2694: Namespace '.../effect/dist/Schema".Schema' has no exported member 'All'.`
- Same at lines 7, 11, 15.

## Root cause

`Schema.All` was removed in Effect 4.0.0-beta.74. The documented replacement for the
existential "any schema" type is `Schema.Top` (see `Schema.d.ts:187` doc comment:
"@see {@link Top} — the existential 'any schema' type (erased type params)"; interface at
`Schema.d.ts:507`; `Schema<out T> extends Top` at :564). Verified by grep: `All` does not
exist anywhere in beta.74 Schema.d.ts.

## Prescribed fix

Replace all four `EffectSchema.Schema.All` occurrences with `EffectSchema.Schema.Top`.
Context of the four sites (from reading the file):
- line 5: a `Map` type / service interface
- line 7: `register` signature
- line 11: `get` signature
- line 15: `entries` signature

Read the file first to confirm the exact import alias used (`EffectSchema` in the error text —
match the file's actual alias) and replace all four occurrences.

## Verify

- `grep -n "Schema.All" src/config/registry.ts` — zero matches after the fix.
- `grep -n "Schema.Top" src/config/registry.ts` — 4 matches.
- Do NOT run typecheck.
