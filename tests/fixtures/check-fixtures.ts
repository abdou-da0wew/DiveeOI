#!/usr/bin/env bun
/**
 * Integrity check for tests/fixtures/ (see tests/fixtures/README.md).
 *
 * This is a plain Bun script, NOT a bun:test suite, on purpose: the root
 * bunfig.toml sets `[test] root = "./do-not-run-tests-from-root"` so that
 * `bun test` run from the repo root fails (the "no root test runner" tripwire,
 * see docs/PROJECT_MAP.md). A plain script avoids fighting that tripwire.
 *
 * Run from the repository root:
 *   bun tests/fixtures/check-fixtures.ts
 *
 * Not wired into CI; on-demand sanity check only.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"

const here = dirname(import.meta.path)
const repoRoot = join(here, "..", "..")

let failures = 0
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function mustRead(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8")
}

// 1. anchor files exist
console.log("fixture anchors:")
const anchors = [
  "tests/fixtures/mini-app/package.json",
  "tests/fixtures/mini-app/index.html",
  "tests/fixtures/mini-app/vite.config.ts",
  "tests/fixtures/mini-app/src/App.tsx",
  "tests/fixtures/mini-app/src/main.tsx",
  "tests/fixtures/mini-app/src/components/layout/sidebar.tsx",
  "tests/fixtures/test-ui-lib/package.json",
  "tests/fixtures/test-ui-lib/src/index.ts",
  "tests/fixtures/test-ui-lib/src/theme.css",
  "tests/fixtures/test-ui-lib/src/components/Button.tsx",
  "tests/fixtures/test-ui-lib/DESIGN.md",
  "tests/fixtures/stale-design-md/DiveeOI-DESIGN.md",
]
for (const p of anchors) {
  check(p, existsSync(join(repoRoot, p)))
}

// 2. every *.json in the fixtures parses
console.log("json files parse:")
function jsonFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...jsonFiles(full))
    else if (entry.name.endsWith(".json")) out.push(full)
  }
  return out
}
for (const abs of jsonFiles(join(repoRoot, "tests/fixtures"))) {
  const rel = abs.slice(repoRoot.length + 1)
  try {
    JSON.parse(readFileSync(abs, "utf8"))
    check(rel, true)
  } catch (e) {
    check(rel, false, String(e))
  }
}

// 3. test-ui-lib DESIGN.md frontmatter matches package.json name
console.log("test-ui-lib consistency:")
try {
  const pkg = JSON.parse(mustRead("tests/fixtures/test-ui-lib/package.json"))
  const design = mustRead("tests/fixtures/test-ui-lib/DESIGN.md")
  const fm = design.match(/^---\n([\s\S]*?)\n---/)
  const fmName = fm?.[1]?.match(/^name:\s*"?(.+?)"?\s*$/m)?.[1]
  check(
    "DESIGN.md frontmatter name === package.json name",
    Boolean(fmName) && fmName === pkg.name,
    `frontmatter=${JSON.stringify(fmName)} package=${JSON.stringify(pkg.name)}`,
  )
  check(
    "DESIGN.md frontmatter present (design-md format)",
    Boolean(fm),
    "missing --- frontmatter block",
  )
} catch (e) {
  check("test-ui-lib DESIGN.md readable", false, String(e))
}

// 4. stale-design-md snapshot still differs from packages/ui/DESIGN.md
console.log("stale-design-md premise:")
try {
  const stale = mustRead("tests/fixtures/stale-design-md/DiveeOI-DESIGN.md")
  const current = mustRead("packages/ui/DESIGN.md")
  check("DiveeOI-DESIGN.md has design-md frontmatter", stale.startsWith("---"))
  check(
    "snapshot still differs from packages/ui/DESIGN.md (still 'stale')",
    stale !== current,
    "files are identical — the fixture premise (old vs current design doc) no longer holds",
  )
} catch (e) {
  check("stale-design-md readable", false, String(e))
}

console.log("")
if (failures > 0) {
  console.error(`fixtures integrity: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log("fixtures integrity: all checks passed")
