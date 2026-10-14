// Subprocess test harness for the DiveeOI CLI. Spawns the real entrypoint
// against a TestLLMServer running in-process at a random port, with full env
// isolation.
//
// This is the missing test tier: in-process tests can't catch bugs that span
// argv parsing → server boot → HTTP routing → exit code.
//
// The CLI in this fork is the hand-rolled dispatcher at src/cli/index.ts, and
// its surface is small: `version`, `help`, `mcp list|validate`,
// `config path|validate|reset`, `db path|entries|reset`. Anything else is an
// "Unknown command" and exits 1. The server is the *default* action — running
// the entrypoint with no arguments boots it, configured through the PORT /
// HOST / CORS env vars that src/main.ts reads. There is no `serve`, `run` or
// `acp` subcommand; a builder for one of those would be testing nothing.
//
// Configuration flows through opencode's built-in test affordances:
//   - OPENCODE_CONFIG_CONTENT      : provider config inline, no files to find
//   - OPENCODE_TEST_HOME           : pins os.homedir() → tmpdir
//   - OPENCODE_DISABLE_PROJECT_CONFIG : skip walking up for opencode.json
//   - OPENCODE_PURE                : skip external plugin discovery + install
//   - OPENCODE_DISABLE_AUTOUPDATE / AUTOCOMPACT / MODELS_FETCH : no background work
// Plus HOME / XDG_* pointing at the tmpdir for belt-and-suspenders isolation.
//
// Note that OPENCODE_CONFIG_CONTENT is read by the server's config service
// (src/config/config.ts) but NOT by the CLI, which resolves its config from
// DIVEEOI_CONFIG or XDG_CONFIG_HOME. So a fresh tmpdir means every CLI
// command sees "no config file", which is exactly what the smoke tests assert.
import { test, type TestOptions } from "bun:test"
import { FSUtil } from "@diveeoi/db/fs-util"
import { AppProcess } from "@diveeoi/db/process"
import { Deferred, Duration, Effect, Layer, Scope, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import path from "node:path"
import { TestLLMServer } from "./llm-server"
import { testProviderConfig } from "./test-provider"
import { it } from "./effect"

const opencodeRoot = path.resolve(import.meta.dir, "../../")
// main.ts is the CLI entry: it dispatches argv through handleCLI and exits when handled, and
// otherwise falls through to starting the server. src/index.ts no longer exists in this fork, so
// pointing at it made every CLI subprocess test fail at spawn instead of exercising anything.
const cliEntry = path.join(opencodeRoot, "src/main.ts")

// Wrap a Bun subprocess pipe (or any ReadableStream<Uint8Array>) as a Stream.
// Centralizes the `evaluate` + `onError` boilerplate and tags errors with the
// stream name so a stderr/stdout failure is greppable in logs.
function fromBunStream(name: string, get: () => ReadableStream<Uint8Array>) {
  return Stream.fromReadableStream({
    evaluate: get,
    onError: (cause) => new Error(`${name} stream error: ${String(cause)}`),
  })
}

// Long-lived processes want the same stderr drain: read every chunk, push to a
// tail buffer, swallow stream errors (the child closing the pipe is normal).
// `log: true` surfaces a real protocol error to logs so a regression doesn't
// silently disappear.
function forkStderrDrain(stream: ReadableStream<Uint8Array>, into: string[]) {
  return Effect.forkScoped(
    fromBunStream("stderr", () => stream).pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Effect.sync(() => into.push(chunk))),
      Effect.ignore({ log: true }),
    ),
  )
}

function isolatedEnv(home: string, configJson: string): Record<string, string> {
  return {
    OPENCODE_TEST_HOME: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: path.join(home, ".local/state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    OPENCODE_CONFIG_CONTENT: configJson,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_AUTH_CONTENT: "{}",
  }
}

export type RunResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export type SpawnOpts = { readonly timeoutMs?: number; readonly env?: Record<string, string> }

// Booting the HTTP server is long-lived: it never exits on its own.
// `serve(opts)` therefore returns a handle inside the caller's Scope: the
// subprocess is killed when the scope closes (test end), and the URL the
// server actually bound to is parsed off the line it prints on startup.
export type ServeOpts = SpawnOpts & {
  // Port to ask for. Defaults to a random high port — see `randomPort()` for
  // why this is not 0.
  readonly port?: number
  readonly hostname?: string
  // How long to wait for the "listening on http://..." line before failing.
  // Default 15s — startup is dominated by bun's transpile + service init, not
  // the actual listen() call.
  readonly readyTimeoutMs?: number
}

export type ServeHandle = {
  // Full URL the server is bound to, e.g. "http://127.0.0.1:54321". Use this
  // as the base for HTTP requests in tests — never assume the port.
  readonly url: string
  readonly hostname: string
  readonly port: number
  // Sends SIGTERM. The scope finalizer also calls this, so tests rarely need
  // to invoke it directly — useful for tests that assert exit behavior.
  readonly kill: () => void
  // Resolves with the exit code once the process exits. Bun returns a number.
  readonly exited: Promise<number>
}

export type OpencodeCli = {
  // Start the HTTP server — the CLI's default action, i.e. running the
  // entrypoint with no arguments — and wait until it's listening. Long-lived:
  // the returned handle is killed when the caller's Scope closes. Fails if the
  // listening line doesn't appear within `readyTimeoutMs`.
  readonly serve: (opts?: ServeOpts) => Effect.Effect<ServeHandle, Error, Scope.Scope>
  // Escape hatch: any CLI invocation with full control over argv. This is how
  // the subcommands (`mcp list`, `config path`, `db entries`, …) are tested.
  readonly spawn: (args: string[], opts?: SpawnOpts) => Effect.Effect<RunResult>
  // Convenience assertion. Dumps captured stderr/stdout on mismatch so CI
  // failures are debuggable without re-running locally.
  readonly expectExit: (result: RunResult, expected: number, label?: string) => void
}

export type CliFixture = {
  readonly llm: TestLLMServer["Service"]
  readonly home: string
  readonly opencode: OpencodeCli
}

// Provisions a TestLLMServer + tmpdir + spawn helper and invokes fn. Cleans
// up the tmpdir on scope exit. TestLLMServer.layer is provided internally so
// the caller doesn't need to wire it up — the fixture's lifetime is tied to
// the surrounding Scope.
export function withCliFixture<A, E>(
  fn: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
): Effect.Effect<A, E | unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const fs = yield* FSUtil.Service
    const appProc = yield* AppProcess.Service

    // FileSystem.makeTempDirectoryScoped handles both creation and scope-tied
    // cleanup — replaces the old mkdir + addFinalizer pair.
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "oc-cli-" })

    const configJson = JSON.stringify(testProviderConfig(llm.url))
    const env = isolatedEnv(home, configJson)

    const spawn = Effect.fn("opencode.spawn")(function* (args: string[], opts?: SpawnOpts) {
      const start = Date.now()
      const timeoutMs = opts?.timeoutMs ?? 30_000
      // stdin: "ignore" so a command that ever reads stdin sees EOF instead of
      // blocking on a pipe nobody writes to. The old Process.run wrapper
      // defaulted to ignore; ChildProcess.make defaults to pipe, so we set it
      // explicitly.
      const command = ChildProcess.make("bun", ["run", "--conditions=browser", cliEntry, ...args], {
        cwd: home,
        env: { ...env, ...opts?.env },
        extendEnv: true,
        stdin: "ignore",
      })
      // Pass timeout to appProc.run rather than wrapping with
      // Effect.timeoutOrElse externally: AppProcess.run is itself scoped, so
      // its built-in timeout triggers the acquireRelease kill finalizer
      // inside cross-spawn-spawner *before* surfacing the AppProcessError —
      // guaranteeing the child is dead by the time the test continues.
      // External timeoutOrElse interrupts the run fiber but races the
      // scope close, which can leak the child past the test boundary.
      //
      // Catch AppProcessError (timeout OR spawn failure) and synthesize a
      // non-zero result so the test sees it via the usual `expectExit`
      // path rather than as an unhandled Effect failure.
      const result = yield* appProc.run(command, { timeout: Duration.millis(timeoutMs) }).pipe(
        Effect.catchTag("AppProcessError", (err) =>
          Effect.succeed({
            command: err.command,
            exitCode: err.exitCode ?? -1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from((err.stderr ?? String(err.cause ?? err.message)) + "\n"),
            stdoutTruncated: false,
            stderrTruncated: false,
          } satisfies AppProcess.RunResult),
        ),
      )
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        durationMs: Date.now() - start,
      }
    })

    const serve = Effect.fn("opencode.serve")(function* (opts?: ServeOpts) {
      // This fork's CLI has no `serve` subcommand. Running the entrypoint with
      // no arguments boots the server, and src/main.ts configures it from the
      // PORT / HOST env vars. We still read the bound port off the startup
      // line rather than assuming it, so a collision (the server scans upward
      // from a taken port) can't point the test at someone else's listener.
      const port = opts?.port ?? randomPort()
      const hostname = opts?.hostname ?? "127.0.0.1"

      // Acquire the subprocess; release sends SIGTERM and awaits exit on
      // scope close. Wrapped in Effect.ignore so a flaky kill doesn't surface
      // as a finalizer error during test teardown.
      const proc = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn(["bun", "run", "--conditions=browser", cliEntry], {
            cwd: home,
            env: { ...process.env, ...env, ...opts?.env, PORT: String(port), HOST: hostname },
            stdout: "pipe",
            stderr: "pipe",
          }),
        ),
        (p) =>
          Effect.promise(() => {
            p.kill()
            return p.exited
          }).pipe(Effect.ignore),
      )

      // Tail buffer so timeout failures can include stderr context. The fork
      // also keeps the OS pipe buffer from filling and wedging the child.
      const stderrChunks: string[] = []
      yield* forkStderrDrain(proc.stderr, stderrChunks)

      // Watch stdout line-by-line for the listening sentinel. Format
      // (see src/main.ts):
      //   "DiveeOI server listening on http://<host>:<port>"
      const readyRe = /listening on (http:\/\/([^\s:]+):(\d+))/
      const readyDeferred = yield* Deferred.make<{ url: string; hostname: string; port: number }>()
      yield* Effect.forkScoped(
        fromBunStream("stdout", () => proc.stdout).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) => {
            const m = line.match(readyRe)
            return m ? Deferred.succeed(readyDeferred, { url: m[1], hostname: m[2], port: Number(m[3]) }) : Effect.void
          }),
          Effect.ignore({ log: true }),
        ),
      )

      const readyTimeoutMs = opts?.readyTimeoutMs ?? 15_000
      const match = yield* Deferred.await(readyDeferred).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(readyTimeoutMs),
          orElse: () =>
            Effect.fail(
              new Error(
                `the server did not become ready within ${readyTimeoutMs}ms\n` +
                  `stderr (last 2000):\n${stderrChunks.join("").slice(-2000)}`,
              ),
            ),
        }),
      )

      return {
        url: match.url,
        hostname: match.hostname,
        port: match.port,
        kill: () => {
          proc.kill()
        },
        exited: proc.exited as Promise<number>,
      } satisfies ServeHandle
    })

    const opencode: OpencodeCli = { serve, spawn, expectExit }

    return yield* fn({ llm, home, opencode })
    // FetchHttpClient is provided so test bodies can `yield* HttpClient.HttpClient`
    // and hit endpoints on `opencode.serve()` without rolling their own fetch.
  }).pipe(
    Effect.provide(
      Layer.mergeAll(TestLLMServer.layer, FetchHttpClient.layer, FSUtil.defaultLayer, AppProcess.defaultLayer),
    ),
  )
}

// src/main.ts maps a requested port of 0 to "try 4096, then any free port"
// (see Server.startWithPortFallback). 4096 is a well-known default other
// processes may already hold, so ask for a random high port instead and let the
// server's upward scan resolve the rare collision. Either way the caller reads
// the port the server actually bound to off the startup line.
function randomPort() {
  return 20_000 + Math.floor(Math.random() * 40_000)
}

// Convenience for the common assertion pattern. Dumps stderr/stdout when
// the exit code doesn't match — saves debugging time on CI failures.
function expectExit(result: RunResult, expected: number, label = "diveeoi") {
  if (result.exitCode === expected) return
  const tail = (s: string, n: number) => (s.length > n ? "..." + s.slice(-n) : s)
  // eslint-disable-next-line no-console
  console.error(`[${label}] expected exit ${expected}, got ${result.exitCode} after ${result.durationMs}ms`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stderr (last 2000):\n${tail(result.stderr, 2000)}`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stdout (last 500):\n${tail(result.stdout, 500)}`)
  throw new Error(`${label}: expected exit ${expected}, got ${result.exitCode}`)
}

// `cliIt.live(name, fixture => effect)` is the same as
// `it.live(name, () => withCliFixture(fixture))` — one fewer nesting level at
// every call site. Use this for any test that needs the opencode CLI fixture.
//
// Subprocess tests must run against the real clock — a TestClock-paused
// environment can't drive a child process. If you need `.only` or `.skip`, fall
// back to `it.live` + `withCliFixture` directly.
// Body's R is `Scope.Scope | never` so tests can yield* scope-requiring
// resources (e.g. `opencode.serve`) without an extra `Effect.scoped` wrapper —
// `withCliFixture`'s outer scope is the natural lifetime.
export const cliIt = {
  live: <A, E>(
    name: string,
    body: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
    opts?: number | TestOptions,
  ) => it.live(name, () => withCliFixture(body), opts),
  concurrent: <A, E>(
    name: string,
    body: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
    opts?: number | TestOptions,
  ) => test.concurrent(name, () => Effect.runPromise(Effect.scoped(withCliFixture(body))), opts),
}
