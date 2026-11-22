# tests/fixtures/

Standalone sample projects kept under version control as **reference material and
documentation-supporting fixtures**. They are intentionally **not** part of the Bun
workspace (root `package.json` only includes `packages/*`), they are **not** in
`bun.lock`, and they have **no automated build/test pipeline**.

The root `bunfig.toml` contains a deliberate tripwire — `[test] root =
"./do-not-run-tests-from-root"` — so that `bun test` run from the repository root
fails instead of sweeping this directory (and the rest of the repo) for tests.
This is by design (see `docs/PROJECT_MAP.md`: "no root test runner on purpose").
A tiny integrity checker for these fixtures exists, but it is a plain Bun script
run explicitly, not a `bun:test` suite, so it does not fight that tripwire:

```sh
# from the repository root; exits non-zero on drift/breakage
bun tests/fixtures/check-fixtures.ts
```

Nothing wires the checker into CI; it is an on-demand sanity check.

## Directory map

| Fixture | What it is | Automated consumer |
|---|---|---|
| `mini-app/` | Synthetic SolidJS sample app | None — reference material |
| `test-ui-lib/` | Synthetic React component-library fixture + design doc | None — reference material |
| `stale-design-md/` | Old ("stale") design-md snapshot | None automated — referenced by docs |

---

## `mini-app/` — synthetic SolidJS sample app

**Package name:** `@diveeoi/mini-app` v1.0.0 (private sample, not published, not
workspace-linked).

**What it contains:** a miniature "chat product" frontend used as a compact,
realistic example of the repo's frontend conventions outside the real app:

- Vite 6 + `vite-plugin-solid` + Tailwind 4 (`vite.config.ts`, `index.html`)
- SolidJS + `@solidjs/router` + `@tanstack/solid-query` (`src/main.tsx`,
  `src/router.tsx`, `src/App.tsx`)
- Route pages: `home`, `chat`, `chat-session`, `settings` (`src/pages/`)
- Layout shell: `sidebar` / `header` (`src/components/layout/`), plus a
  deliberately trivial placeholder test `src/components/__tests__/sidebar.test.tsx`
  (`expect(true).toBe(true)` — it demonstrates test-file placement for a Vite/
  Vitest layout; it asserts nothing)
- Stores: `session-store.tsx` (Solid context store with auth token),
  `settings-store.ts`; API helper `src/lib/api.ts` (bearer-token fetch wrapper)
- Scripts (`package.json`): `dev`, `build`, `typecheck`, `lint`, `test`
  (Vitest) — none are run automatically anywhere in the monorepo.

**Origin:** added 2026-07-06 in commit `485ad79` (committer: Mr.Abdou), the same
commit that added `test-ui-lib/DESIGN.md` and regenerated `packages/ui/DESIGN.md`.

**Consumers:** none automated. Doc references only:

- `docs/PROJECT_MAP.md:57` lists the directory as "sample apps used as fixtures".

**How it should be used:** reference/scratch material when sketching frontend
features or doc examples. Do **not** add it to the Bun workspace and do not
replace the real app with it; if it starts drifting conceptually from repo
conventions, either refresh it or delete it (it has no dependents).

---

## `test-ui-lib/` — synthetic React component-library fixture

**Package name:** `@diveeoi/test-ui-lib` v0.2.0 (private sample, not published,
not workspace-linked).

**What it contains:** a small React 19 component library — `Button`, `Dialog`,
`Badge` (`src/components/`, each with `*.module.css`), a token theme
(`src/theme.css`, light/dark via CSS custom properties), `tsconfig.json`, and a
package-level `DESIGN.md` written in the *design-md artifact format*
(YAML frontmatter + token/component/Do's & Don'ts sections).

**Origin:** two commits, both by Mr.Abdou:

- `a3a6eee` (2026-06-29): `package.json`, `tsconfig.json`, `src/index.ts`,
  `src/theme.css` and the component sources (`src/components/*`)
- `485ad79` (2026-07-06): `DESIGN.md`

**Consumers:** none automated. It exists as a worked example of the
`design-md-extractor` / `stitch::extract-design-md` document style that
`packages/ui/DESIGN.md` and `packages/app/FRONTEND-MAP.md` are produced in
(see `packages/app/README.md:81` for the generator note). Its `DESIGN.md`
frontmatter deliberately matches the library's `package.json` (`name`,
`version`, component inventory), which makes it a self-consistent sample of a
"good" (in-sync) design doc — the counterpart to `stale-design-md/` below.

**How it should be used:** reference when writing or reviewing generated
design-md artifacts; sample input/target for any future design-doc extractor
tests. Not a real dependency of any package; do not add it to the workspace.

---

## `stale-design-md/` — old design-md snapshot

**File:** `DiveeOI-DESIGN.md` (141 lines, `version: alpha`, palette with
`primary: #dcde8d` …).

**What it is:** a preserved copy of the **older generation** of the DiveeOI
design-md (pre-v2). It documents what a *stale* design artifact looks like —
the current `packages/ui/DESIGN.md` (v2, "DiveeOI Design System (v2)") no longer
matches it.

**Origin:** added 2026-06-29 in commit `a3a6eee`.

**Consumers:** none automated — no test compares files here. Doc references only:

- `packages/ui/README.md:48` — "`DESIGN.md` in this package is a
  `design-md-extractor` artifact and is asserted as stale in
  `tests/fixtures/stale-design-md`"
- `docs/architecture.md:325` — "`packages/ui/DESIGN.md` is stale by the fixture
  test" (historical wording; the assertion lives in docs, not in code)

**How it should be used:** historical/reference snapshot illustrating the
design-md format the v2 doc replaced. If the repo later adds an automated
freshness check for `packages/ui/DESIGN.md`, this directory is where the old
snapshot would be compared against — until then it is reference material only.

---

## Integrity checker (`check-fixtures.ts`)

`bun tests/fixtures/check-fixtures.ts` verifies, with zero dependencies:

1. each fixture's anchor files exist (`mini-app/package.json`,
   `test-ui-lib/DESIGN.md`, `stale-design-md/DiveeOI-DESIGN.md`, …);
2. every `*.json` file in the fixtures parses;
3. `test-ui-lib/DESIGN.md` frontmatter `name` matches the `package.json` name;
4. `stale-design-md/DiveeOI-DESIGN.md` still exists as a distinct design-md
   (frontmatter present) and still differs from `packages/ui/DESIGN.md`
   (its premise — being the old, non-current snapshot — still holds).

Run it manually after editing fixtures; it is **not** wired into CI.
