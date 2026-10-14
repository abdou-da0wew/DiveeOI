// Subprocess integration tests for the server the CLI boots. Spawns the real
// entrypoint in headless mode and exercises it over HTTP — this is the only
// test tier that catches bugs spanning env/config resolution → server boot →
// routing → instance loading.
//
// The server is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The port is read off the
// "DiveeOI server listening on http://host:port" line the entrypoint prints,
// so the test never assumes one.
//
// Note: there is no `serve` subcommand in this fork. Running the entrypoint
// with no arguments IS the serve path — src/main.ts dispatches argv through
// handleCLI, and an empty argv falls through to Server.listen.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"

describe("diveeoi server (subprocess)", () => {
  // Smoke test: server starts, binds a port, and /global/health responds.
  // If this fails, all other server tests likely will too — debug here first.
  cliIt.live(
    "starts, binds a port, and serves /global/health",
    ({ opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/^http:\/\//)

        const client = yield* HttpClient.HttpClient
        const res = yield* client.get(`${server.url}/global/health`)
        expect(res.status).toBe(200)
        // GlobalHealth is a plain JSON struct. We don't lock in further shape
        // here — any 200 with parseable JSON is enough proof the routing +
        // auth-bypass + instance loading is alive.
        const body = yield* res.json
        expect(body).toBeDefined()
      }),
    60_000,
  )

  // The scope-close finalizer must actually terminate the child. Without this
  // test a regression in the kill path (e.g. a future refactor that forgets
  // to wire the finalizer) would leak processes on every test run.
  cliIt.live(
    "kills the subprocess on scope close",
    ({ opencode }) =>
      Effect.gen(function* () {
        // Inner scope so we can observe `.exited` resolving after it closes.
        const exitedPromise = yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* opencode.serve()
            // Capture the Promise, not the resolved value — scope closes after
            // this gen returns, at which point the finalizer kills the child.
            return server.exited
          }),
        )
        // After scope close: finalizer fired, process must have exited.
        const code = yield* Effect.promise(() => exitedPromise)
        // Bun reports the exit code; SIGTERM-killed processes return non-null
        // (typically 143 on POSIX). We just require resolution within a sane
        // window — anything else means the kill didn't take.
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )
})
