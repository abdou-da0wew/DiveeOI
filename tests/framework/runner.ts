#!/usr/bin/env bun
/**
 * DiveeOI unified test framework runner — zero new npm dependencies.
 *
 * Usage:  bun tests/framework/runner.ts <smoke|unit|integration|e2e|all|report>
 *
 * Suites:
 *   smoke        fast gate (< 2 min target): bun health probe + 4 canary test runs
 *   unit         full `bun test` per package (auto-discovered, continue-on-fail)
 *   integration  end-to-end-ish behavioral suites that run fully inside the sandbox
 *   e2e          Playwright against a LIVE app server; SKIPS cleanly when the
 *                server (BASE_URL, default http://127.0.0.1:3000) is not reachable
 *                within 3s or when Playwright is not installed
 *   all          smoke + unit + integration + e2e, aggregated
 *   report       same as `all` (both refresh tests/framework/last-report.{md,json})
 *
 * Exit codes: 0 = all green (skips allowed) · 1 = any failure/timeout/usage error.
 *
 * Environment:
 *   FW_TIMEOUT_MS   per-spawned-command timeout (default 240000). The full unit
 *                   suite on slower machines may need e.g. FW_TIMEOUT_MS=900000.
 *   BASE_URL        app URL used by the e2e suite (default http://127.0.0.1:3000,
 *                   the Vite dev port from packages/app/vite.config.ts).
 *   NO_COLOR        disable colored console output (auto-disabled when piped).
 *
 * Implementation notes:
 *  - Only node:child_process (spawnSync) + node:fs are used; no extra deps.
 *  - Every spawned command streams into a log file under tests/framework/logs/
 *    (memory-safe for very chatty suites like packages/server); failures print
 *    the log tail to the console.
 *  - A suite that throws is recorded as a failed result — it can never kill the
 *    whole run (crash-proof contract).
 */

import { spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

// ── layout ────────────────────────────────────────────────────────────────────
const FW_DIR = import.meta.dir // tests/framework (this file lives there)
const ROOT = resolve(FW_DIR, "..", "..") // repo root
const PKGS_DIR = join(ROOT, "packages")
const LOG_DIR = join(FW_DIR, "logs")
const E2E_DIR = join(FW_DIR, "e2e")
// @playwright/test is already a devDependency of packages/app (catalog v1.59.1)
// and its browsers live in ~/.cache/ms-playwright — the framework adds none.
const PW_PKG_DIR = join(ROOT, "packages", "app", "node_modules", "@playwright", "test")
const PW_CLI = join(PW_PKG_DIR, "cli.js")
const PW_BIN = join(ROOT, "packages", "app", "node_modules", ".bin", "playwright")

const REPORT_MD = join(FW_DIR, "last-report.md")
const REPORT_JSON = join(FW_DIR, "last-report.json")

// ── config ────────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 240_000
const TIMEOUT_MS = (() => {
  const raw = Number(process.env.FW_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
})()
const E2E_PROBE_MS = 3_000 // reachability probe window for the live server
const E2E_DEFAULT_BASE_URL = "http://127.0.0.1:3000" // Vite dev port (packages/app/vite.config.ts)
const LOG_TAIL_LINES = 20

// ── console colors ────────────────────────────────────────────────────────────
const COLOR = !process.env.NO_COLOR && (process.env.FORCE_COLOR ? true : Boolean(process.stdout.isTTY))
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = (s: string) => c("1", s)
const dim = (s: string) => c("2", s)
const green = (s: string) => c("32", s)
const yellow = (s: string) => c("33", s)
const red = (s: string) => c("31", s)
const cyan = (s: string) => c("36", s)

// ── types ─────────────────────────────────────────────────────────────────────
type SuiteName = "smoke" | "unit" | "integration" | "e2e"
type Status = "pass" | "fail" | "skip" | "timeout"

interface Target {
  /** package dir name under packages/ (or "<root>" for the env probe) */
  pkg: string
  label: string
  /** argv passed to `bun` (cwd = package dir). Empty for special kinds. */
  args: string[]
  note?: string
  env?: Record<string, string>
  kind: "bun" | "e2e"
}

interface Result {
  suite: SuiteName
  pkg: string
  label: string
  command: string
  status: Status
  exitCode: number | null
  durationMs: number
  logFile?: string
  detail?: string
}

interface RunReport {
  timestamp: string
  bunVersion: string
  gitSha: string
  requested: string
  timeoutMs: number
  suites: { name: SuiteName; results: Result[] }[]
  totals: Record<"pass" | "fail" | "skip" | "timeout", number>
  verdict: "GREEN" | "RED"
  durationMs: number
  notes: string[]
}

// ── suite definitions (edit here to change what runs) ────────────────────────
// SMOKE — the fast pre-merge gate. Four canary runs pinned by the sprint
// baseline (memory 2 pass, app parity 1 pass at HEAD c0951df). Keep it small:
// anything slower than ~30s belongs in unit/integration instead.
const SMOKE_TARGETS: Target[] = [
  {
    pkg: "app",
    label: "i18n locale parity canary",
    args: ["test", "src/i18n/parity.test.ts"],
    note: "co-located app unit test; all other app tests run in the unit suite",
  },
  { pkg: "memory", label: "memory graph scoring", args: ["test"], note: "baseline: 2 pass" },
  {
    pkg: "learning",
    label: "retrieval canaries (rewrite/gate/hybrid)",
    args: ["test", "test/rewrite.test.ts", "test/gate.test.ts", "test/hybrid.test.ts"],
  },
  { pkg: "http-recorder", label: "cassette record/replay core", args: ["test"] },
]

// INTEGRATION — suites that exercise real end-to-end behavior inside the
// sandbox (worker pools, ingest runs, fault injection, sqlite record/replay).
// Files verified at sprint HEAD; a missing file is recorded as a failure so
// suite drift cannot slip through silently.
const INTEGRATION_TARGETS: Target[] = [
  {
    pkg: "learning",
    label: "embed worker pool + ingest turn + download faults",
    args: ["test", "test/embed-pool.test.ts", "test/ingest-turn.test.ts", "test/download-faults.test.ts"],
    env: { SKIP_LIVE_EMBED: "1" }, // package convention: never hit live embed services
  },
  { pkg: "memory", label: "memory service end-to-end", args: ["test", "test/memory.test.ts"] },
  { pkg: "http-recorder", label: "record/replay behavioral suite", args: ["test", "test/record-replay.test.ts"] },
]

// Packages whose full `bun test` run was ALREADY RED at the sprint baseline
// (HEAD c0951df, measured before this framework existed). Failures here are
// labeled "PRE-EXISTING" in the report so a red unit suite is not mistaken for
// a framework/sprint regression. Edit this map as the baseline moves.
const PREEXISTING_UNIT_FAILURES: Record<string, string> = {
  // 2801 tests / 246 fail at HEAD c0951df (loop + HttpApi suites) — ~12 min run,
  // needs FW_TIMEOUT_MS above the 240s default to finish at all.
  server: "server unit suite was already RED at sprint baseline HEAD c0951df (loop/HttpApi suites, 246 failures) — PRE-EXISTING, not caused by this framework",
  // LocationServiceMap > "isolates location state while sharing location policy
  // with catalog" fails deterministically at the current tree (re-verified
  // standalone); packages/db was not touched by this sprint — PRE-EXISTING.
  db: "db unit suite fails at the current tree (LocationServiceMap isolation test, reproduced standalone) — PRE-EXISTING, packages/db untouched by this sprint",
}

// UNIT — discovered, not hard-coded. Rules (verified against the repo layout):
//  * a package participates when it has a test/ dir OR any *.test.* files
//    outside node_modules/dist;
//  * if the package defines a "test" script we run `bun run test` so package
//    specifics survive (e.g. learning: SKIP_LIVE_EMBED=1, ui: happydom preload
//    via ../app/happydom.ts, server/db/llm: --timeout 30000 --only-failures);
//  * packages/app keeps its tests co-located under src/** plus test-browser/
//    and needs `--conditions=browser --preload ./happydom.ts` — its own
//    `test` script (test:unit && test:virtualizer) encodes exactly that;
//  * packages without tests (identity, mcp, plugin, plugins, script, sdk,
//    effect-sqlite-node) are skipped.
function unitTargets(): { targets: Target[]; skipped: string[] } {
  const targets: Target[] = []
  const skipped: string[] = []
  for (const name of listPackages()) {
    const dir = join(PKGS_DIR, name)
    const pkgJsonPath = join(dir, "package.json")
    if (!existsSync(pkgJsonPath)) {
      skipped.push(`${name} (no package.json)`)
      continue
    }
    if (!hasTests(dir)) {
      skipped.push(`${name} (no test files)`)
      continue
    }
    let script: string | undefined
    try {
      script = JSON.parse(readFileSync(pkgJsonPath, "utf8"))?.scripts?.test
    } catch {
      skipped.push(`${name} (unreadable package.json)`)
      continue
    }
    if (typeof script === "string" && script.trim().length > 0) {
      targets.push({ pkg: name, label: `bun run test (${script})`, args: ["run", "test"] })
    } else {
      targets.push({ pkg: name, label: "bun test", args: ["test"] })
    }
  }
  return { targets, skipped }
}

function listPackages(): string[] {
  try {
    return readdirSync(PKGS_DIR)
      .filter((n) => statSync(join(PKGS_DIR, n)).isDirectory())
      .sort()
  } catch {
    return []
  }
}

const TEST_EXCLUDE_DIRS = new Set(["node_modules", "dist", ".turbo", ".git", "test-results", "playwright-report"])

function hasTests(dir: string, depth = 0): boolean {
  if (depth > 6) return false
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry === "test" && statSync(join(dir, entry)).isDirectory()) return true
  }
  for (const entry of entries) {
    if (TEST_EXCLUDE_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isFile() && /\.test\.(ts|tsx|js|mjs)$/.test(entry)) return true
    if (st.isDirectory() && hasTests(full, depth + 1)) return true
  }
  return false
}

// ── helpers ───────────────────────────────────────────────────────────────────
function bunVersion(): string {
  const r = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 10_000 })
  return r.status === 0 ? (r.stdout ?? "").trim() : "unknown"
}

function gitSha(): string {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8", timeout: 10_000 })
  return r.status === 0 ? (r.stdout ?? "").trim() : "unknown"
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m${String(s).padStart(2, "0")}s`
}

function statusIcon(status: Status): string {
  switch (status) {
    case "pass":
      return green("✓ pass  ")
    case "fail":
      return red("✗ fail  ")
    case "timeout":
      return red("⏱ timeout")
    case "skip":
      return yellow("⏭ skip  ")
  }
}

function tail(text: string, lines: number): string {
  const arr = text.split("\n")
  return arr.slice(Math.max(0, arr.length - lines)).join("\n")
}

/** Live progress line, printed as soon as a command finishes. */
function printResult(r: Result): void {
  const dur = dim(formatDuration(r.durationMs))
  console.log(`  ${statusIcon(r.status)}  ${bold(r.pkg.padEnd(14))} ${r.label} ${dur}`)
  if (r.detail) console.log(`    ${dim("└")} ${dim(r.detail)}`)
  if ((r.status === "fail" || r.status === "timeout") && r.logFile && existsSync(r.logFile)) {
    console.log(red(`    └ log tail (${r.logFile.replace(ROOT + "/", "")}):`))
    try {
      console.log(dim(indent(tail(readFileSync(r.logFile, "utf8"), LOG_TAIL_LINES), "      ")))
    } catch {
      /* ignore */
    }
  }
}

/** Probe a URL; returns true if ANY HTTP response arrives within `ms`. */
async function isReachable(url: string, ms: number): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "follow" })
    void res.body?.cancel().catch(() => {})
    return true // any response (4xx included) means a live server is listening
  } catch {
    return false
  }
}

function playwrightBrowsersInstalled(): boolean {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright")
  try {
    return readdirSync(dir).some((n) => n.startsWith("chromium"))
  } catch {
    return false
  }
}

// ── execution ─────────────────────────────────────────────────────────────────
let logCounter = 0

function spawnBun(target: Target, suite: SuiteName, cwd: string, extraEnv: Record<string, string> = {}): Result {
  const started = Date.now()
  const command = `bun ${target.args.join(" ")}  (cwd: ${cwd.replace(ROOT + "/", "")})`
  const logFile = join(LOG_DIR, `${suite}-${String(++logCounter).padStart(2, "0")}-${target.pkg}.log`)
  const base: Omit<Result, "status"> = { suite, pkg: target.pkg, label: target.label, command, exitCode: null, durationMs: 0, logFile }

  try {
    const fd = openSync(logFile, "w")
    const r = spawnSync("bun", target.args, {
      cwd,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      env: { ...process.env, ...extraEnv, ...(target.env ?? {}), FORCE_COLOR: "0" },
      stdio: ["ignore", fd, fd],
    })
    closeSync(fd)
    const durationMs = Date.now() - started

    if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      const timeoutResult: Result = { ...base, status: "timeout", durationMs, detail: `exceeded FW_TIMEOUT_MS=${TIMEOUT_MS}` }
      printResult(timeoutResult)
      return timeoutResult
    }
    if (r.error) {
      const spawnFail: Result = { ...base, status: "fail", durationMs, detail: `spawn error: ${r.error.message}` }
      printResult(spawnFail)
      return spawnFail
    }
    const ok = r.status === 0
    const result: Result = { ...base, status: ok ? "pass" : "fail", exitCode: r.status, durationMs }
    printResult(result)
    return result
  } catch (err) {
    // crash-proof: a throwing suite is a failed result, never a dead run
    const crashed: Result = { ...base, status: "fail", durationMs: Date.now() - started, detail: `runner exception: ${err}` }
    printResult(crashed)
    return crashed
  }
}

function missingTargetResult(target: Target, suite: SuiteName, why: string): Result {
  return {
    suite,
    pkg: target.pkg,
    label: target.label,
    command: `bun ${target.args.join(" ")}`,
    status: "fail",
    exitCode: null,
    durationMs: 0,
    detail: why,
  }
}

async function runSmoke(): Promise<Result[]> {
  const results: Result[] = []
  // 0) environment probe: bun itself
  const probeStart = Date.now()
  const v = bunVersion()
  results.push({
    suite: "smoke",
    pkg: "<root>",
    label: "bun availability + version",
    command: "bun --version",
    status: v === "unknown" ? "fail" : "pass",
    exitCode: v === "unknown" ? 1 : 0,
    durationMs: Date.now() - probeStart,
    detail: v === "unknown" ? "bun --version failed" : `bun ${v}`,
  })
  printResult(results[0])
  // 1..n) canary test runs
  for (const target of SMOKE_TARGETS) {
    results.push(spawnBun(target, "smoke", join(PKGS_DIR, target.pkg)))
  }
  return results
}

async function runUnit(): Promise<{ results: Result[]; notes: string[] }> {
  const { targets, skipped } = unitTargets()
  const results: Result[] = []
  for (const target of targets) {
    results.push(spawnBun(target, "unit", join(PKGS_DIR, target.pkg)))
  }
  const notes = skipped.length ? [`unit discovery skipped (no test files): ${skipped.join(", ")}`] : []
  // label known pre-existing failures so reports stay honest about blame
  for (const r of results) {
    const known = PREEXISTING_UNIT_FAILURES[r.pkg]
    if (known && (r.status === "fail" || r.status === "timeout")) {
      r.detail = `${r.detail ? `${r.detail} · ` : ""}PRE-EXISTING: ${known}`
      notes.push(`unit/${r.pkg}: failures labeled PRE-EXISTING (see PREEXISTING_UNIT_FAILURES in runner.ts)`)
    }
  }
  return { results, notes }
}

async function runIntegration(): Promise<Result[]> {
  const results: Result[] = []
  for (const target of INTEGRATION_TARGETS) {
    for (const arg of target.args.slice(2)) {
      if (!existsSync(join(PKGS_DIR, target.pkg, arg))) {
        results.push(missingTargetResult(target, "integration", `target file missing: packages/${target.pkg}/${arg}`))
        printResult(results[results.length - 1])
      }
    }
    if (results.some((r) => r.pkg === target.pkg && r.detail?.startsWith("target file missing"))) continue
    results.push(spawnBun(target, "integration", join(PKGS_DIR, target.pkg)))
  }
  return results
}

/**
 * e2e — Playwright against a LIVE app server. Skips (never fails the run)
 * when the server is unreachable within 3s or Playwright is unavailable.
 */
async function runE2E(): Promise<{ results: Result[]; notes: string[] }> {
  const baseUrl = process.env.BASE_URL ?? E2E_DEFAULT_BASE_URL
  const mkSkip = (detail: string): Result => ({
    suite: "e2e",
    pkg: "app",
    label: "Playwright e2e (app loads, login form, console errors)",
    command: `playwright test --config tests/framework/e2e/playwright.config.ts  (BASE_URL=${baseUrl})`,
    status: "skip",
    exitCode: null,
    durationMs: 0,
    detail,
  })
  const notes: string[] = []

  if (!existsSync(PW_PKG_DIR) && !existsSync(PW_BIN)) {
    notes.push("e2e skipped: Playwright not available")
    const skipResult = mkSkip("e2e skipped: Playwright not available (packages/app/node_modules/@playwright/test missing)")
    printResult(skipResult)
    return { results: [skipResult], notes }
  }
  if (!playwrightBrowsersInstalled()) {
    notes.push("e2e skipped: Playwright browsers not installed")
    const skipResult = mkSkip("e2e skipped: Playwright browsers not installed (run: bun --cwd packages/app x playwright install chromium)")
    printResult(skipResult)
    return { results: [skipResult], notes }
  }
  const reachable = await isReachable(baseUrl, E2E_PROBE_MS)
  if (!reachable) {
    notes.push(`e2e skipped: no live server at ${baseUrl}`)
    const skipResult = mkSkip(`e2e skipped: no live server at ${baseUrl} (start the app with 'bun run dev:both', or point BASE_URL at a running instance)`)
    printResult(skipResult)
    return { results: [skipResult], notes }
  }

  const target: Target = {
    pkg: "app",
    label: "Playwright e2e (app loads, login form, console errors)",
    args: [PW_CLI, "test", "--config", join(E2E_DIR, "playwright.config.ts")],
    note: "invoked via bun against the workspace-local @playwright/test (no new dependency)",
  }
  const result = spawnBun(target, "e2e", E2E_DIR)
  // enrich with playwright's own pass/fail/skip counts from the log, if parseable
  try {
    const out = readFileSync(result.logFile ?? "", "utf8")
    const passed = out.match(/(\d+)\s+passed/)?.[1]
    const failed = out.match(/(\d+)\s+failed/)?.[1]
    const skippedN = out.match(/(\d+)\s+skipped/)?.[1]
    if (passed || failed || skippedN) {
      result.detail = `playwright reported: ${passed ?? 0} passed, ${failed ?? 0} failed, ${skippedN ?? 0} skipped`
    }
  } catch {
    /* log unreadable — keep result as-is */
  }
  notes.push(`e2e ran against ${baseUrl}`)
  return { results: [result], notes }
}

// ── reports ───────────────────────────────────────────────────────────────────
function totalsOf(suites: { results: Result[] }[]): RunReport["totals"] {
  const totals = { pass: 0, fail: 0, skip: 0, timeout: 0 }
  for (const s of suites) for (const r of s.results) totals[r.status]++
  return totals
}

function writeReports(report: RunReport): void {
  // JSON (machine-readable, always written)
  writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`)

  // Markdown (human-readable)
  const lines: string[] = []
  lines.push(`# DiveeOI Test Framework Report`)
  lines.push("")
  lines.push(`- **Timestamp (UTC):** ${report.timestamp}`)
  lines.push(`- **Bun:** ${report.bunVersion} · **git:** ${report.gitSha}`)
  lines.push(`- **Command:** \`bun tests/framework/runner.ts ${report.requested}\``)
  lines.push(`- **Per-command timeout:** ${report.timeoutMs}ms (env \`FW_TIMEOUT_MS\`)`)
  const icon = report.verdict === "GREEN" ? "✅" : "❌"
  lines.push(
    `- **Overall verdict:** ${icon} **${report.verdict}** — ${report.totals.pass} pass · ${report.totals.fail} fail · ${report.totals.skip} skip · ${report.totals.timeout} timeout in ${formatDuration(report.durationMs)}`,
  )
  lines.push("")
  for (const suite of report.suites) {
    lines.push(`## ${suite.name}`)
    lines.push("")
    lines.push("| Package | Command | Status | Duration | Detail |")
    lines.push("|---|---|---|---|---|")
    for (const r of suite.results) {
      const iconS = r.status === "pass" ? "✅" : r.status === "skip" ? "⏭️" : r.status === "timeout" ? "⏱️" : "❌"
      const detail = (r.detail ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")
      lines.push(`| ${r.pkg} | \`${r.command}\` | ${iconS} ${r.status} | ${formatDuration(r.durationMs)} | ${detail} |`)
    }
    lines.push("")
  }
  const failures = report.suites.flatMap((s) => s.results.filter((r) => r.status === "fail" || r.status === "timeout"))
  if (failures.length > 0) {
    lines.push(`## Failures`)
    lines.push("")
    for (const f of failures) {
      lines.push(`### ${f.suite} / ${f.pkg} — ${f.label}`)
      lines.push("")
      lines.push(`- command: \`${f.command}\``)
      lines.push(`- exit: ${f.exitCode ?? "n/a"}${f.status === "timeout" ? " (timed out)" : ""}`)
      if (f.logFile) lines.push(`- full log: \`${f.logFile.replace(ROOT + "/", "")}\``)
      lines.push("")
      if (f.logFile && existsSync(f.logFile)) {
        try {
          lines.push("```")
          lines.push(tail(readFileSync(f.logFile, "utf8"), LOG_TAIL_LINES).trimEnd())
          lines.push("```")
          lines.push("")
        } catch {
          /* ignore unreadable log */
        }
      }
    }
  }
  if (report.notes.length > 0) {
    lines.push(`## Notes`)
    lines.push("")
    for (const n of report.notes) lines.push(`- ${n}`)
    lines.push("")
  }
  lines.push(`_Generated by tests/framework/runner.ts — see tests/framework/README.md for suite docs._`)
  writeFileSync(REPORT_MD, `${lines.join("\n")}\n`)
}

// ── suite orchestration ───────────────────────────────────────────────────────
async function execute(requested: SuiteName | "all"): Promise<RunReport> {
  const startedAt = Date.now()
  const suiteNames: SuiteName[] = requested === "all" ? ["smoke", "unit", "integration", "e2e"] : [requested]
  const suites: { name: SuiteName; results: Result[] }[] = []
  const notes: string[] = []

  for (const name of suiteNames) {
    try {
      if (name === "smoke") {
        suites.push({ name, results: await runSmoke() })
      } else if (name === "unit") {
        const { results, notes: n } = await runUnit()
        suites.push({ name, results })
        notes.push(...n)
      } else if (name === "integration") {
        suites.push({ name, results: await runIntegration() })
      } else if (name === "e2e") {
        const { results, notes: n } = await runE2E()
        suites.push({ name, results })
        notes.push(...n)
      }
    } catch (err) {
      // crash-proof contract: record the explosion as a failed result
      suites.push({
        name,
        results: [
          {
            suite: name,
            pkg: "<framework>",
            label: `suite ${name} crashed`,
            command: "-",
            status: "fail",
            exitCode: null,
            durationMs: 0,
            detail: `unhandled runner exception: ${err}`,
          },
        ],
      })
    }
  }

  const totals = totalsOf(suites)
  const report: RunReport = {
    timestamp: new Date().toISOString(),
    bunVersion: bunVersion(),
    gitSha: gitSha(),
    requested,
    timeoutMs: TIMEOUT_MS,
    suites,
    totals,
    verdict: totals.fail + totals.timeout === 0 ? "GREEN" : "RED",
    durationMs: Date.now() - startedAt,
    notes,
  }
  return report
}

// ── console rendering ─────────────────────────────────────────────────────────
/** Banner printed once at run start, before live progress lines. */
function printBanner(requested: string): void {
  console.log("")
  console.log(bold("╭─ DiveeOI Test Framework ") + "─".repeat(28))
  console.log(
    `│ ${cyan(requested.padEnd(11))} bun ${bunVersion()} · git ${gitSha()} · timeout ${TIMEOUT_MS}ms · ${new Date().toISOString()}`,
  )
  console.log("╰" + "─".repeat(50))
}

function render(report: RunReport): void {
  console.log("")
  console.log(bold("── Summary ") + "─".repeat(40))
  for (const suite of report.suites) {
    const t = totalsOf([suite])
    console.log(`  ${suite.name.padEnd(11)} ${t.pass} pass · ${t.fail} fail · ${t.skip} skip · ${t.timeout} timeout`)
  }
  console.log(
    `  ${"total".padEnd(11)} ${report.totals.pass} pass · ${report.totals.fail} fail · ${report.totals.skip} skip · ${report.totals.timeout} timeout`,
  )
  const verdictLine =
    report.verdict === "GREEN" ? green(bold(`verdict: GREEN (skips allowed)`)) : red(bold(`verdict: RED`))
  console.log(`  exit ${report.verdict === "GREEN" ? 0 : 1} · ${verdictLine}`)
  console.log(
    `  ${dim(`reports: tests/framework/last-report.md · tests/framework/last-report.json · logs: tests/framework/logs/`)}`,
  )
  // machine-readable one-liner for CI logs
  console.log(
    `FW-JSON {"verdict":"${report.verdict}","pass":${report.totals.pass},"fail":${report.totals.fail},"skip":${report.totals.skip},"timeout":${report.totals.timeout},"durationMs":${report.durationMs}}`,
  )
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => (l.length ? prefix + l : prefix))
    .join("\n")
}

// ── main ──────────────────────────────────────────────────────────────────────
const USAGE = `Usage: bun tests/framework/runner.ts <suite>

Suites:
  smoke         fast gate: bun probe + 4 canary bun test runs (< 2 min target)
  unit          full bun test per package (auto-discovered, continue-on-fail)
  integration   sandbox end-to-end behavioral suites
  e2e           Playwright vs live app server (BASE_URL, skips when unreachable)
  all           smoke + unit + integration + e2e
  report        alias of "all" (both refresh tests/framework/last-report.{md,json})

Env: FW_TIMEOUT_MS (default ${DEFAULT_TIMEOUT_MS}), BASE_URL, NO_COLOR
Exit codes: 0 = green (skips allowed), 1 = any failure.`

async function main(): Promise<number> {
  const requested = process.argv[2]
  const valid = new Set(["smoke", "unit", "integration", "e2e", "all", "report"])
  if (!requested || !valid.has(requested)) {
    console.error(USAGE)
    console.error(requested ? red(`\nunknown suite: ${requested}`) : red(`\nmissing suite argument`))
    return 1
  }
  mkdirSync(LOG_DIR, { recursive: true })
  const suiteName: SuiteName | "all" = requested === "report" ? "all" : (requested as SuiteName)
  printBanner(requested)
  const report = await execute(suiteName)
  writeReports(report) // shared: every mode refreshes the report files
  render(report)
  return report.verdict === "GREEN" ? 0 : 1
}

try {
  process.exit(await main())
} catch (err) {
  console.error(red(`framework runner crashed: ${err}`))
  process.exit(1)
}
