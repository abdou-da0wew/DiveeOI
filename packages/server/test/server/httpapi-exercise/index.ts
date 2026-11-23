/**
 * End-to-end exerciser for the Effect HttpApi routes.
 *
 * The goal is not to be a normal unit test file. This is a route-coverage harness:
 * every public route should have a small scenario that proves the route decodes
 * requests, uses the right instance context, mutates storage when expected, and
 * returns the expected response shape.
 *
 * The script intentionally isolates `OPENCODE_DB` before importing modules that touch
 * storage. Scenarios may create/delete sessions and reset the database after each run,
 * so this must never point at a developer's real session database.
 *
 * DSL shape:
 * - `http.protected.get/post/...` starts a scenario for one OpenAPI route key.
 * - `.seeded(...)` creates typed per-scenario state using Effect helpers on `ctx`.
 * - `.at(...)` builds the request from that typed state.
 * - `.json(...)` / `.jsonEffect(...)` assert response shape and optional side effects.
 * - `.mutating()` tells the runner to reset isolated state after destructive routes.
 */
import { Effect } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { TestLLMServer } from "../../lib/llm-server"
import path from "path"
import { array, boolean, check, isRecord, message, object, stable } from "./assertions"
import { controlledPtyInput, http, route } from "./dsl"
import {
  cleanupExercisePaths,
  exerciseConfigDirectory,
  exerciseDataDirectory,
  exerciseDatabasePath,
  exerciseGlobalRoot,
} from "./environment"
import { color, printHeader, printResults } from "./report"
import { coverageResult, parseOptions, routeKey, routeKeys, selectedScenarios } from "./routing"
import { runScenario } from "./runner"
import { disposeApps } from "./backend"
import { runtime } from "./runtime"
import { type JsonObject, type Scenario, type ScenarioContext } from "./types"

function cursor(input: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(input)).toString("base64url")
}

function data(validate: (value: any) => void) {
  return (body: any) => {
    object(body)
    validate(body.data)
  }
}

function locationData(validate: (value: any) => void) {
  return (body: any) => {
    object(body)
    object(body.location)
    object(body.location.project)
    validate(body.data)
  }
}

// ---------------------------------------------------------------------------
// Seed helpers for the route groups below (auth, prefs, tasks, console, TL).
// ---------------------------------------------------------------------------

const EXERCISE_EMAIL = "exercise@diveeoi.test"
const EXERCISE_PASSWORD = "exercise-password-123"

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

/** Register + login a throwaway user through the real routes; returns the tokens. */
const authSeed = Effect.fn("exercise.authSeed")(function* (ctx: ScenarioContext, email = EXERCISE_EMAIL) {
  const registered = yield* ctx.request({
    path: "/api/auth/register",
    method: "POST",
    body: { email, password: EXERCISE_PASSWORD, username: "exercise" },
  })
  if (registered.status !== 200) throw new Error(`seed register failed: ${registered.status} ${registered.text}`)
  const login = yield* ctx.request({
    path: "/api/auth/login",
    method: "POST",
    body: { email, password: EXERCISE_PASSWORD },
  })
  if (login.status !== 200) throw new Error(`seed login failed: ${login.status} ${login.text}`)
  object(login.body)
  check(typeof login.body.accessToken === "string", "seed login should return an access token")
  check(typeof login.body.refreshToken === "string", "seed login should return a refresh token")
  return {
    email,
    password: EXERCISE_PASSWORD,
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  }
})

/** Create a paused autonomous task through the real route; returns its id. */
const taskSeed = Effect.fn("exercise.taskSeed")(function* (ctx: ScenarioContext, prompt: string) {
  const created = yield* ctx.request({
    path: "/api/v1/tasks",
    method: "POST",
    body: { prompt, autoRun: false, source: "user" },
  })
  if (created.status !== 200) throw new Error(`seed task create failed: ${created.status} ${created.text}`)
  object(created.body)
  object(created.body.data)
  check(typeof created.body.data.id === "string", "seed task create should return an id")
  return { id: created.body.data.id as string }
})

/** Upload a tiny book through the real route; returns the book id. */
const bookUploadSeed = Effect.fn("exercise.bookSeed")(function* (ctx: ScenarioContext, title: string) {
  const uploaded = yield* ctx.request({
    path: "/targeted-learning/books",
    method: "POST",
    headers: ctx.headers(),
    body: {
      filename: `${title}.txt`,
      contentBase64: Buffer.from(`Exercise book content for ${title}.\n`).toString("base64"),
      title,
    },
  })
  if (uploaded.status !== 200) throw new Error(`seed book upload failed: ${uploaded.status} ${uploaded.text}`)
  object(uploaded.body)
  check(typeof uploaded.body.bookId === "string", "seed book upload should return a bookId")
  return { bookId: uploaded.body.bookId as string }
})

/**
 * Seed one student memory row through the memory service (same module the handler uses).
 * The route layer must have been built once so the TL runtime (dataDir) is registered.
 */
const studentMemorySeed = Effect.fn("exercise.studentMemorySeed")(function* (ctx: ScenarioContext, text: string) {
  const warm = yield* ctx.request({ path: "/targeted-learning/health", headers: ctx.headers() })
  if (warm.status !== 200) throw new Error(`seed TL warmup failed: ${warm.status} ${warm.text}`)
  const service = yield* Effect.promise(() => import("@diveeoi/learning/memory/service"))
  const written = yield* Effect.promise(() => service.writeStudentMemory({ kind: "goal", text }))
  if (!written.ok || !written.id) throw new Error(`seed student memory write failed: ${written.reason ?? "unknown"}`)
  return { memoryID: written.id }
})

/**
 * Seed one book note row directly in books.db (notes require a ready book, which the
 * exercise cannot produce without the embedding model). Returns the note id.
 */
const bookNoteSeed = Effect.fn("exercise.bookNoteSeed")(function* (ctx: ScenarioContext) {
  const warm = yield* ctx.request({ path: "/targeted-learning/health", headers: ctx.headers() })
  if (warm.status !== 200) throw new Error(`seed TL warmup failed: ${warm.status} ${warm.text}`)
  const runtimeModule = yield* Effect.promise(() => import("@diveeoi/learning/runtime"))
  const rt = runtimeModule.getRuntime()
  check(!!rt?.booksStore.available && !!rt.booksStore.db, "seed needs an available books.db")
  const db = rt.booksStore.db!
  const now = Date.now()
  yield* Effect.promise(() =>
    Promise.resolve(
      db.run(
        `INSERT OR IGNORE INTO books (id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at)
         VALUES ('bk_exercise_note', 'exercise-note-book', 'Exercise Note Book', 'hash_exercise_note', '', 'ready', '', '', ?)`,
        now,
      ),
    ),
  )
  yield* Effect.promise(() =>
    Promise.resolve(
      db.run(
        `INSERT OR IGNORE INTO book_notes (id, book_id, source_hash, kind, text, citations_json, source_session_id, stale, created_at, updated_at)
         VALUES ('bn_exercise_note', 'bk_exercise_note', 'hash_exercise_note', 'definition', 'Exercise note about photosynthesis.', '[]', NULL, 0, ?, ?)`,
        now,
        now,
      ),
    ),
  )
  return { noteID: "bn_exercise_note" }
})

/**
 * A throwaway local "console" that answers the device-authorization endpoints. The
 * finalizer stops the server when the scenario scope closes.
 */
const fakeConsoleSeed = Effect.gen(function* () {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/auth/device/code")
        return Response.json({
          device_code: "dc_exercise",
          user_code: "EXRC-CODE",
          verification_uri_complete: "/device?code=EXRC-CODE",
          expires_in: 600,
          interval: 5,
        })
      if (url.pathname === "/auth/device/token")
        return Response.json({ error: "authorization_pending", error_description: "awaiting approval" })
      return new Response("exercise console: not found", { status: 404 })
    },
  })
  yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(server.stop(true))))
  return { url: `http://127.0.0.1:${server.port}` }
})

/** Start a device login against the local fake console; returns the attempt id. */
const consoleLoginSeed = Effect.fn("exercise.consoleLoginSeed")(function* (ctx: ScenarioContext) {
  const consoleState = yield* fakeConsoleSeed
  const login = yield* ctx.request({
    path: "/experimental/console/login",
    method: "POST",
    headers: ctx.headers(),
    body: { server: consoleState.url },
  })
  if (login.status !== 200) throw new Error(`seed console login failed: ${login.status} ${login.text}`)
  object(login.body)
  check(typeof login.body.attemptID === "string", "seed console login should return an attemptID")
  return { attemptID: login.body.attemptID as string }
})

const scenarios: Scenario[] = [
  http.protected
    .get("/global/health", "global.health")
    .global()
    .json(200, (body) => {
      object(body)
      check(body.healthy === true, "server should report healthy")
    }),
  http.protected
    .get("/global/event", "global.event")
    .global()
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "global event should be an SSE stream")
          check(result.text.includes("server.connected"), "global event should emit initial connection event")
        }),
      "status",
    ),
  http.protected.get("/global/config", "global.config.get").global().json(),
  http.protected
    .patch("/global/config", "global.config.update")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseConfigDirectory, "opencode.jsonc"),
          JSON.stringify({ username: "httpapi-global" }, null, 2),
        ),
      ),
    )
    .at(() => ({ path: "/global/config", body: { username: "httpapi-global" } }))
    .jsonEffect(
      200,
      (body) =>
        Effect.gen(function* () {
          object(body)
          check(body.username === "httpapi-global", "global config update should return patched config")
          const text = yield* Effect.promise(() =>
            Bun.file(path.join(exerciseConfigDirectory, "opencode.jsonc")).text(),
          )
          check(text.includes('"username": "httpapi-global"'), "global config update should write isolated config file")
        }),
      "status",
    ),
  http.protected
    .post("/global/dispose", "global.dispose")
    .global()
    .mutating()
    .json(
      200,
      (body) => {
        check(body === true, "global dispose should return true")
      },
      "status",
    ),
  http.protected.get("/path", "path.get").json(200, (body, ctx) => {
    object(body)
    check(body.directory === ctx.directory, "directory should resolve from x-opencode-directory")
    check(body.worktree === ctx.directory, "worktree should resolve from x-opencode-directory")
  }),
  http.protected.get("/vcs", "vcs.get").json(),
  http.protected.get("/vcs/status", "vcs.status").json(200, array),
  http.protected
    .get("/vcs/diff", "vcs.diff")
    .at((ctx) => ({ path: "/vcs/diff?mode=git", headers: ctx.headers() }))
    .json(200, array),
  http.protected.get("/vcs/diff/raw", "vcs.diff.raw").status(
    200,
    (_ctx, result) =>
      Effect.sync(() => {
        check(typeof result.text === "string", "raw VCS diff should return text")
      }),
    "status",
  ),
  http.protected
    .post("/vcs/apply", "vcs.apply")
    .inProject({ git: false })
    .at((ctx) => ({ path: "/vcs/apply", headers: ctx.headers(), body: { patch: "" } }))
    .status(400, undefined, "status"),
  http.protected.get("/command", "command.list").json(200, array, "status"),
  http.protected.get("/agent", "app.agents").json(200, array, "status"),
  http.protected.get("/skill", "app.skills").json(200, array, "status"),
  http.protected.get("/lsp", "lsp.status").json(200, array),
  http.protected.get("/formatter", "formatter.status").json(200, array),
  http.protected.get("/config", "config.get").json(200, undefined, "status"),
  http.protected
    .patch("/config", "config.update")
    .mutating()
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: "httpapi-local" } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.username === "httpapi-local", "local config update should return patched config")
      },
      "status",
    ),
  http.protected
    .patch("/config", "config.update.invalid")
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: 1 } }))
    .status(400),
  http.protected.get("/config/providers", "config.providers").json(),
  http.protected
    .get("/config/composer-key", "config.composerKey.status")
    .json(
      200,
      (body) => {
        object(body)
        check(body.configured === false, "no Artificial Analysis key should be configured in a fresh exercise env")
      },
      "status",
    ),
  http.protected
    .post("/config/composer-key", "config.composerKey.set")
    .mutating()
    .at((ctx) => ({
      path: "/config/composer-key",
      headers: ctx.headers(),
      body: { apiKey: "exercise-key-0123456789abcdef" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.configured === true, "composer key set should report configured")
      },
      "status",
    ),
  http.protected
    .delete("/config/composer-key", "config.composerKey.remove")
    .mutating()
    .json(
      200,
      (body) => {
        object(body)
        check(body.configured === false, "composer key removal should clear the configured flag")
      },
      "status",
    ),
  http.protected.get("/project", "project.list").json(200, array, "status"),
  http.protected.get("/project/current", "project.current").json(
    200,
    (body, ctx) => {
      object(body)
      check(body.worktree === ctx.directory, "current project should resolve from scenario directory")
    },
    "status",
  ),
  http.protected
    .patch("/project/{projectID}", "project.update")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/project/{projectID}", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: { name: "HTTP API Project", commands: { start: "bun --version" } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.name === "HTTP API Project", "project update should return patched name")
        check(
          isRecord(body.commands) && body.commands.start === "bun --version",
          "project update should return patched command",
        )
      },
      "status",
    ),
  http.protected
    .patch("/project/{projectID}", "project.update.missing")
    .mutating()
    .at((ctx) => ({
      path: route("/project/{projectID}", { projectID: "project_httpapi_missing" }),
      headers: ctx.headers(),
      body: { name: "Missing Project" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/project/git/init", "project.initGit")
    .mutating()
    .inProject({ git: false })
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.worktree === ctx.directory, "git init should return current project")
        check(body.vcs === "git", "git init should mark the project as git-backed")
      },
      "status",
    ),
  http.protected
    .get("/project/{projectID}/directories", "project.directories")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/project/{projectID}/directories", { projectID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, array, "status"),
  http.protected
    .post("/experimental/project/{projectID}/copy/generate-name", "experimental.projectCopy.generateName")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy/generate-name", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => {
      object(body)
      check(typeof body.name === "string" && body.name.length > 0, "generated copy name should be non-empty")
    }),
  http.protected
    .post("/experimental/project/{projectID}/copy", "experimental.projectCopy.create")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .delete("/experimental/project/{projectID}/copy", "experimental.projectCopy.remove")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .post("/experimental/project/{projectID}/copy/refresh", "experimental.projectCopy.refresh")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy/refresh", { projectID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected.get("/provider", "provider.list").json(),
  http.protected.get("/provider/auth", "provider.auth").json(),
  http.protected
    .post("/provider/{providerID}/oauth/authorize", "provider.oauth.authorize")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/authorize", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http.protected
    .post("/provider/{providerID}/oauth/callback", "provider.oauth.callback")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/callback", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http.protected.get("/permission", "permission.list").json(200, array),
  http.protected
    .post("/permission/{requestID}/reply", "permission.reply.invalid")
    .at((ctx) => ({
      path: route("/permission/{requestID}/reply", { requestID: "per_httpapi" }),
      headers: ctx.headers(),
      body: { reply: "bad" },
    }))
    .status(400),
  http.protected
    .post("/permission/{requestID}/reply", "permission.reply")
    .at((ctx) => ({
      path: route("/permission/{requestID}/reply", { requestID: "per_httpapi" }),
      headers: ctx.headers(),
      body: { reply: "once" },
    }))
    .json(404, object, "status"),
  http.protected.get("/question", "question.list").json(200, array),
  http.protected
    .post("/question/{requestID}/reply", "question.reply.invalid")
    .at((ctx) => ({
      path: route("/question/{requestID}/reply", { requestID: "que_httpapi_reply" }),
      headers: ctx.headers(),
      body: { answers: "Yes" },
    }))
    .status(400),
  http.protected
    .post("/question/{requestID}/reply", "question.reply")
    .at((ctx) => ({
      path: route("/question/{requestID}/reply", { requestID: "que_httpapi_reply" }),
      headers: ctx.headers(),
      body: { answers: [["Yes"]] },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/question/{requestID}/reject", "question.reject")
    .at((ctx) => ({
      path: route("/question/{requestID}/reject", { requestID: "que_httpapi_reject" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/file", "file.list")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file?${new URLSearchParams({ path: "." })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/file/content", "file.read")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "hello.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.content === "hello", `content should match seeded file: ${JSON.stringify(body)}`)
    }),
  http.protected
    .get("/file/content", "file.read.missing")
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "missing.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.type === "text" && body.content === "", "missing file content should return an empty text result")
    }),
  http.protected.get("/file/status", "file.status").json(200, array),
  http.protected
    .get("/find", "find.text")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/find?${new URLSearchParams({ pattern: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/find/file", "find.files")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({
      path: `/find/file?${new URLSearchParams({ query: "hello", dirs: "false" })}`,
      headers: ctx.headers(),
    }))
    .json(200, array),
  http.protected
    .get("/find/symbol", "find.symbols")
    .seeded((ctx) => ctx.file("hello.ts", "export const hello = 1\n"))
    .at((ctx) => ({ path: `/find/symbol?${new URLSearchParams({ query: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/event", "event.stream")
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "event should be an SSE stream")
          check(result.text.includes("server.connected"), "event should emit initial connection event")
        }),
      "status",
    ),
  http.protected.get("/mcp", "mcp.status").json(),
  http.protected
    .post("/mcp", "mcp.add")
    .mutating()
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-disabled", config: { type: "local", command: ["bun", "--version"], enabled: false } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body["httpapi-disabled"])
        check(body["httpapi-disabled"].status === "disabled", "disabled MCP server should be added without spawning")
      },
      "status",
    ),
  http.protected
    .post("/mcp", "mcp.add.invalid")
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-invalid", config: { type: "invalid" } },
    }))
    .status(400),
  http.protected
    .post("/mcp/{name}/auth", "mcp.auth.start")
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .delete("/mcp/{name}/auth", "mcp.auth.remove")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/auth/authenticate", "mcp.auth.authenticate")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/authenticate", { name: "httpapi-missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/auth/callback", "mcp.auth.callback")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/callback", { name: "httpapi-missing" }),
      headers: ctx.headers(),
      body: { code: "code" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/connect", "mcp.connect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/connect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/disconnect", "mcp.disconnect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/disconnect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected.get("/pty/shells", "pty.shells").json(200, array),
  http.protected.get("/pty", "pty.list").json(200, array),
  http.protected
    .post("/pty", "pty.create")
    .mutating()
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: controlledPtyInput("HTTP API PTY") }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.title === "HTTP API PTY", "PTY create should return requested title")
        check(body.command === "/bin/sh", "PTY create should use controlled shell command")
        check(body.cwd === ctx.directory, "PTY create should default cwd to scenario directory")
      },
      "status",
    ),
  http.protected
    .post("/pty", "pty.create.invalid")
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: { command: 1 } }))
    .status(400),
  http.protected
    .post("/pty/{ptyID}/connect-token", "pty.connectToken.invalid")
    .at((ctx) => ({
      path: route("/pty/{ptyID}/connect-token", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(403, undefined, "status"),
  http.protected
    .get("/pty/{ptyID}", "pty.get")
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404),
  http.protected
    .put("/pty/{ptyID}", "pty.update")
    .mutating()
    .at((ctx) => ({
      path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
      body: { size: { rows: 0, cols: 0 } },
    }))
    .status(400),
  http.protected
    .delete("/pty/{ptyID}", "pty.remove")
    .mutating()
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .get("/pty/{ptyID}/connect", "pty.connect")
    .at((ctx) => ({ path: route("/pty/{ptyID}/connect", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404, undefined, "none"),
  http.protected.get("/experimental/console", "experimental.console.get").json(),
  http.protected.get("/experimental/console/orgs", "experimental.console.listOrgs").json(),
  http.protected
    .post("/experimental/console/switch", "experimental.console.switchOrg")
    .at((ctx) => ({
      path: "/experimental/console/switch",
      headers: ctx.headers(),
      body: { accountID: "httpapi-account", orgID: "httpapi-org" },
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/experimental/console/login", "experimental.console.login")
    .probe({ path: "/experimental/console/login", body: { server: 1 } })
    .seeded(() => fakeConsoleSeed)
    .at((ctx) => ({
      path: "/experimental/console/login",
      headers: ctx.headers(),
      body: { server: ctx.state.url },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(typeof body.attemptID === "string" && body.attemptID.length > 0, "login should return an attempt id")
        check(body.userCode === "EXRC-CODE", "login should surface the console user code")
        check(
          body.verificationURL === `${ctx.state.url}/device?code=EXRC-CODE`,
          "login should resolve the verification URL against the console",
        )
        check(body.server === ctx.state.url, "login should echo the normalized console server")
        check(typeof body.intervalMs === "number" && body.intervalMs >= 0, "login should return the poll interval")
        check(typeof body.expiresInMs === "number" && body.expiresInMs > 0, "login should return the expiry window")
      },
      "status",
    ),
  http.protected
    .post("/experimental/console/poll", "experimental.console.poll")
    .seeded((ctx) => consoleLoginSeed(ctx))
    .at((ctx) => ({
      path: "/experimental/console/poll",
      headers: ctx.headers(),
      body: { attemptID: ctx.state.attemptID },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.status === "pending", "polling an unapproved device flow should report pending")
        check(typeof body.nextPollMs === "number" && body.nextPollMs >= 0, "poll should return the server-owned cadence")
      },
      "status",
    ),
  http.protected
    .post("/experimental/console/cancel", "experimental.console.cancel")
    .mutating()
    .seeded((ctx) => consoleLoginSeed(ctx))
    .at((ctx) => ({
      path: "/experimental/console/cancel",
      headers: ctx.headers(),
      body: { attemptID: ctx.state.attemptID },
    }))
    .json(
      200,
      (body) => {
        check(body === true, "cancel should discard the attempt and return true")
      },
      "status",
    ),
  http.protected
    .post("/experimental/console/logout", "experimental.console.logout")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/console/logout",
      headers: ctx.headers(),
      body: { accountID: "acc_exercise_missing" },
    }))
    .json(
      200,
      (body) => {
        check(body === true, "logout should return true even for an unknown account")
      },
      "status",
    ),
  http.protected.get("/experimental/workspace/adapter", "experimental.workspace.adapter.list").json(200, array),
  http.protected.get("/experimental/workspace", "experimental.workspace.list").json(200, array),
  http.protected.get("/experimental/workspace/status", "experimental.workspace.status").json(200, array),
  http.protected
    .post("/experimental/workspace", "experimental.workspace.create")
    .at((ctx) => ({ path: "/experimental/workspace", headers: ctx.headers(), body: {} }))
    .status(400),
  http.protected
    .post("/experimental/workspace/sync-list", "experimental.workspace.syncList")
    .status(204, undefined, "status"),
  http.protected
    .delete("/experimental/workspace/{id}", "experimental.workspace.remove")
    .mutating()
    .at((ctx) => ({
      path: route("/experimental/workspace/{id}", { id: "wrk_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(200),
  http.protected
    .post("/experimental/workspace/warp", "experimental.workspace.warp")
    .at((ctx) => ({
      path: "/experimental/workspace/warp",
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .post("/experimental/control-plane/move-session", "experimental.controlPlane.moveSession")
    .global()
    .at(() => ({
      path: "/experimental/control-plane/move-session",
      body: {},
    }))
    .status(400),
  http.protected
    .get("/experimental/tool", "tool.list")
    .at((ctx) => ({
      path: `/experimental/tool?${new URLSearchParams({ provider: "opencode", model: "test" })}`,
      headers: ctx.headers(),
    }))
    .json(200, array, "status"),
  http.protected.get("/experimental/tool/ids", "tool.ids").json(200, array),
  http.protected.get("/experimental/worktree", "worktree.list").json(200, array),
  http.protected
    .post("/experimental/worktree", "worktree.create")
    // Auth-mode probe must decode-fail: a bare POST without the directory header would
    // resolve the instance to the exerciser's cwd and create a full worktree of that repo.
    .probe({ path: "/experimental/worktree", body: { name: 1 } })
    .mutating()
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: "api-dsl" } }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(typeof body.directory === "string", "created worktree should include directory")
          yield* ctx.worktreeRemove(body.directory)
        }),
      "status",
    ),
  http.protected
    .post("/experimental/worktree", "worktree.create.invalid")
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: 1 } }))
    .status(400),
  http.protected
    .delete("/experimental/worktree", "worktree.remove")
    .probe({ path: "/experimental/worktree", body: { directory: 1 } })
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-remove" }))
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { directory: ctx.state.directory } }))
    .json(200, (body) => {
      check(body === true, "worktree remove should return true")
    }),
  http.protected
    .post("/experimental/worktree/reset", "worktree.reset")
    .probe({ path: "/experimental/worktree/reset", body: { directory: 1 } })
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-reset" }))
    .at((ctx) => ({
      path: "/experimental/worktree/reset",
      headers: ctx.headers(),
      body: { directory: ctx.state.directory },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "worktree reset should return true")
        yield* ctx.worktreeRemove(ctx.state.directory)
      }),
    ),
  http.protected
    .get("/experimental/session", "experimental.session.list")
    .at((ctx) => ({ path: "/experimental/session?roots=false&archived=false", headers: ctx.headers() }))
    .json(200, array),
  http.protected.get("/experimental/capabilities", "experimental.capabilities.get").json(200, (body) => {
    check(typeof body === "object" && body !== null, "capabilities should be an object")
    check("backgroundSubagents" in body, "capabilities should report background subagents")
  }),
  http.protected
    .post("/experimental/session/{sessionID}/background", "experimental.session.background")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Background route owner" }))
    .at((ctx) => ({
      path: route("/experimental/session/{sessionID}/background", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === false, "background route should be a no-op without running subagents")
    }),
  http.protected.get("/experimental/resource", "experimental.resource.list").json(),
  http.protected
    .post("/sync/history", "sync.history.list")
    .at((ctx) => ({ path: "/sync/history", headers: ctx.headers(), body: {} }))
    .json(200, array),
  http.protected
    .post("/sync/replay", "sync.replay")
    .at((ctx) => ({ path: "/sync/replay", headers: ctx.headers(), body: { directory: ctx.directory, events: [] } }))
    .status(400),
  http.protected
    .post("/sync/steal", "sync.steal.invalid")
    .at((ctx) => ({ path: "/sync/steal", headers: ctx.headers(), body: {} }))
    .status(400, undefined, "status"),
  http.protected
    .post("/sync/start", "sync.start")
    .mutating()
    .preserveDatabase()
    .json(200, (body) => {
      check(body === true, "sync start should return true when no workspace sessions exist")
    }),
  http.protected
    .post("/instance/dispose", "instance.dispose")
    .mutating()
    .json(200, (body) => {
      check(body === true, "instance dispose should return true")
    }),
  http.protected
    .post("/log", "app.log")
    .global()
    .at(() => ({ path: "/log", body: { service: "httpapi-exercise", level: "info", message: "route coverage" } }))
    .json(200, (body) => {
      check(body === true, "log route should return true")
    }),
  http.protected
    .put("/auth/{providerID}", "auth.set")
    .global()
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }), body: { type: "api", key: "test-key" } }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth set should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(isRecord(auth.test) && auth.test.key === "test-key", "auth set should write isolated auth file")
      }),
    ),
  http.protected
    .delete("/auth/{providerID}", "auth.remove")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseDataDirectory, "auth.json"),
          JSON.stringify({ test: { type: "api", key: "remove-me" } }),
        ),
      ),
    )
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }) }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth remove should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(auth.test === undefined, "auth remove should delete provider from isolated auth file")
      }),
    ),
  http.protected.get("/api/health", "v2.health.get").json(200, (body) => {
    object(body)
    check(body.healthy === true, "v2 server should report healthy")
  }),
  http.protected.get("/api/location", "v2.location.get").json(200, object),
  http.protected.get("/api/agent", "v2.agent.list").json(200, locationData(array)),
  http.protected.get("/api/model", "v2.model.list").json(200, locationData(array)),
  http.protected.get("/api/provider", "v2.provider.list").json(200, locationData(array)),
  http.protected.get("/api/integration", "v2.integration.list").json(200, locationData(array)),
  http.protected
    .get("/api/integration/{integrationID}", "v2.integration.get")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}", { integrationID: "missing" }),
      headers: ctx.headers(),
    }))
    .json(200, object),
  http.protected
    .post("/api/integration/{integrationID}/connect/key", "v2.integration.connect.key")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}/connect/key", { integrationID: "missing" }),
      headers: ctx.headers(),
      body: { key: "test" },
    }))
    .status(500, undefined, "status"),
  http.protected
    .post("/api/integration/{integrationID}/connect/oauth", "v2.integration.connect.oauth")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}/connect/oauth", { integrationID: "missing" }),
      headers: ctx.headers(),
      body: { methodID: "missing", inputs: {} },
    }))
    .status(500, undefined, "status"),
  http.protected
    .get("/api/integration/attempt/{attemptID}", "v2.integration.attempt.status")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}", { attemptID: "con_missing" }),
      headers: ctx.headers(),
    }))
    .status(500, undefined, "status"),
  http.protected
    .post("/api/integration/attempt/{attemptID}/complete", "v2.integration.attempt.complete")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}/complete", { attemptID: "con_missing" }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(500, undefined, "status"),
  http.protected
    .delete("/api/integration/attempt/{attemptID}", "v2.integration.attempt.cancel")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}", { attemptID: "con_missing" }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected
    .delete("/api/credential/{credentialID}", "v2.credential.remove")
    .at((ctx) => ({
      path: route("/api/credential/{credentialID}", { credentialID: "cred_missing" }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected
    .patch("/api/credential/{credentialID}", "v2.credential.update")
    .at((ctx) => ({
      path: route("/api/credential/{credentialID}", { credentialID: "cred_missing" }),
      headers: ctx.headers(),
      body: { label: "Work" },
    }))
    .status(204, undefined, "status"),
  http.protected.get("/api/command", "v2.command.list").json(200, locationData(array)),
  http.protected.get("/api/skill", "v2.skill.list").json(200, locationData(array)),
  http.protected
    .get("/api/event", "v2.event.subscribe")
    .stream()
    .status(
      200,
      (ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "v2 event should be an SSE stream")
          check(result.text.includes("server.connected"), "v2 event should emit initial connection event")
          check(!!ctx.directory && result.text.includes(ctx.directory), "v2 event should include the resolved location")
        }),
      "status",
    ),
  http.protected
    .get("/api/fs/read/*", "v2.fs.read")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: "/api/fs/read/hello.txt", headers: ctx.headers() }))
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.text === "hello\n", "v2 fs read should return the file body")
          check(result.contentType.includes("text/plain"), "v2 fs read should return the file content type")
        }),
      "status",
    ),
  http.protected.get("/api/fs/list", "v2.fs.list").json(200, locationData(array)),
  http.protected
    .get("/api/fs/find", "v2.fs.find")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: "/api/fs/find?query=hello&type=file", headers: ctx.headers() }))
    .json(200, locationData(array)),
  http.protected.get("/api/pty", "v2.pty.list").json(200, locationData(array)),
  http.protected
    .post("/api/pty", "v2.pty.create")
    .mutating()
    .at((ctx) => ({ path: "/api/pty", headers: ctx.headers(), body: controlledPtyInput("HTTP API V2 PTY") }))
    .json(200, locationData(object)),
  http.protected
    .get("/api/pty/{ptyID}", "v2.pty.get")
    .at((ctx) => ({ path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .put("/api/pty/{ptyID}", "v2.pty.update")
    .mutating()
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
      body: { title: "missing" },
    }))
    .json(404, object, "status"),
  http.protected
    .delete("/api/pty/{ptyID}", "v2.pty.remove")
    .mutating()
    .at((ctx) => ({ path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/api/pty/{ptyID}/connect-token", "v2.pty.connectToken")
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}/connect-token", { ptyID: "pty_httpapi_missing" }),
      headers: { ...ctx.headers(), "x-opencode-ticket": "1" },
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/pty/{ptyID}/connect", "v2.pty.connect")
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}/connect", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "none"),
  http.protected.get("/api/reference", "v2.reference.list").json(200, object),
  http.protected
    .get("/api/provider/{providerID}", "v2.provider.get")
    .at((ctx) => ({ path: route("/api/provider/{providerID}", { providerID: "missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected.get("/api/permission/request", "v2.permission.request.list").json(200, (body) => {
    object(body)
    object(body.location)
    array(body.data)
  }),
  http.protected.get("/api/question/request", "v2.question.request.list").json(200, (body) => {
    object(body)
    object(body.location)
    array(body.data)
  }),
  http.protected
    .get("/api/session/{sessionID}/permission", "v2.session.permission.list")
    .seeded((ctx) => ctx.session({ title: "Permission list owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .get("/api/session/{sessionID}/question", "v2.session.question.list")
    .seeded((ctx) => ctx.session({ title: "Question list owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .post("/api/session/{sessionID}/permission/{requestID}/reply", "v2.session.permission.reply")
    .seeded((ctx) => ctx.session({ title: "Permission owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission/{requestID}/reply", {
        sessionID: ctx.state.id,
        requestID: "per_httpapi_missing",
      }),
      headers: ctx.headers(),
      body: { reply: "once" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/question/{requestID}/reply", "v2.session.question.reply")
    .seeded((ctx) => ctx.session({ title: "Question reply owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question/{requestID}/reply", {
        sessionID: ctx.state.id,
        requestID: "que_httpapi_missing",
      }),
      headers: ctx.headers(),
      body: { answers: [] },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/question/{requestID}/reject", "v2.session.question.reject")
    .seeded((ctx) => ctx.session({ title: "Question reject owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question/{requestID}/reject", {
        sessionID: ctx.state.id,
        requestID: "que_httpapi_missing",
      }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected.get("/api/permission/saved", "v2.permission.saved.list").json(200, (body) => {
    object(body)
    array(body.data)
  }),
  http.protected
    .delete("/api/permission/saved/{id}", "v2.permission.saved.remove")
    .at((ctx) => ({ path: route("/api/permission/saved/{id}", { id: "psv_httpapi_missing" }), headers: ctx.headers() }))
    .status(204, undefined, "status"),
  http.protected
    .get("/api/session", "v2.session.list")
    .at((ctx) => ({ path: "/api/session?roots=true", headers: ctx.headers() }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.filters")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        limit: "2",
        order: "asc",
        path: ".",
        roots: "false",
        start: "0",
        search: "missing",
        directory: ctx.directory ?? "",
      })}`,
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.cursor")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        limit: "2",
        cursor: cursor({
          order: "desc",
          directory: ctx.directory,
          anchor: { id: "ses_httpapi_missing", time: 0, direction: "next" },
        }),
      })}`,
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.cursor.invalid")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        cursor: "invalid",
      })}`,
      headers: ctx.headers(),
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/api/session", "v2.session.create")
    .at((ctx) => ({
      path: "/api/session",
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: {},
    }))
    .json(200, data(object)),
  http.protected
    .get("/api/session/{sessionID}", "v2.session.get")
    .seeded((ctx) => ctx.session({ title: "Session get" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(object)),
  http.protected
    .get("/api/session/{sessionID}/context", "v2.session.context")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/context", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.params")
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" })}?${new URLSearchParams({
        limit: "2",
        order: "asc",
      })}`,
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.cursor")
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" })}?${new URLSearchParams({
        limit: "2",
        directory: ctx.directory ?? "",
        cursor: cursor({ id: "msg_httpapi_missing", time: 0, order: "desc", direction: "next" }),
      })}`,
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.cursor.invalid")
    .seeded((ctx) => ctx.session({ title: "Invalid message cursor owner" }))
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: ctx.state.id })}?${new URLSearchParams({
        cursor: cursor({ id: "msg_httpapi_missing", time: 0, order: "desc", direction: "next" }),
        order: "asc",
      })}`,
      headers: ctx.headers(),
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/api/session/{sessionID}/prompt", "v2.session.prompt.invalid")
    .seeded((ctx) => ctx.session({ title: "Invalid prompt owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/prompt", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/api/session/{sessionID}/compact", "v2.session.compact")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/compact", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "status"),
  http.protected
    .post("/api/session/{sessionID}/wait", "v2.session.wait")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/wait", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "status"),
  // ---------------------------------------------------------------------------
  // v2 auth routes: the /api/auth/ prefix deliberately bypasses Basic auth, so
  // register/login/logout/resend/verify-email are public while me/refresh/profile
  // authenticate with a Bearer JWT (protectedJwt: only the 401 leg is probed).
  // ---------------------------------------------------------------------------
  http.public
    .post("/api/auth/register", "v2.auth.register")
    .global()
    .mutating()
    .at((ctx) => ({
      path: "/api/auth/register",
      body: { email: EXERCISE_EMAIL, password: EXERCISE_PASSWORD, username: "exercise" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body.user)
        check(body.user.email === EXERCISE_EMAIL, "register should return the normalized email")
        check(body.user.role === "admin", "the first registration claims the admin role")
        check(body.user.verified === true, "register should verify the user when email delivery is unconfigured")
      },
      "status",
    ),
  http.public
    .post("/api/auth/login", "v2.auth.login")
    .global()
    .seeded((ctx) => authSeed(ctx))
    .at((ctx) => ({ path: "/api/auth/login", body: { email: ctx.state.email, password: ctx.state.password } }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(typeof body.accessToken === "string" && body.accessToken.length > 0, "login should issue an access token")
        check(typeof body.refreshToken === "string", "non-browser login should receive the refresh token in the body")
        object(body.user)
        check(body.user.email === ctx.state.email, "login should return the user")
      },
      "status",
    ),
  http.protected
    .post("/api/auth/refresh", "v2.auth.refresh")
    .global()
    .protectedJwt()
    .seeded((ctx) => authSeed(ctx))
    .at((ctx) => ({ path: "/api/auth/refresh", body: { refreshToken: ctx.state.refreshToken } }))
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.accessToken === "string" && body.accessToken.length > 0, "refresh should issue a new access token")
        check(typeof body.refreshToken === "string" && body.refreshToken.length > 0, "refresh should rotate the refresh token")
        object(body.user)
      },
      "status",
    ),
  http.public
    .post("/api/auth/logout", "v2.auth.logout")
    .global()
    .mutating()
    .at((ctx) => ({ path: "/api/auth/logout" }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === true, "logout should acknowledge")
      },
      "status",
    ),
  http.protected
    .get("/api/auth/me", "v2.auth.me")
    .global()
    .protectedJwt()
    .probe({ path: "/api/auth/me?token=exercise-probe" })
    .seeded((ctx) => authSeed(ctx))
    .at((ctx) => ({
      path: `/api/auth/me?${new URLSearchParams({ token: "exercise-probe" })}`,
      headers: bearer(ctx.state.accessToken),
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        object(body.user)
        check(body.user.email === ctx.state.email, "me should resolve the Bearer token to the user")
      },
      "status",
    ),
  // Email-verification system DISABLED (2026-11-23): both endpoints answer
  // { ok: false } uniformly — no token consumption, no enumeration, no
  // misleading success.
  http.public
    .get("/api/auth/verify-email", "v2.auth.verifyEmail.disabled")
    .global()
    .at((ctx) => ({ path: `/api/auth/verify-email?${new URLSearchParams({ token: "exercise-invalid" })}` }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === false, "verify-email is disabled and must answer ok:false for any token")
      },
      "status",
    ),
  http.public
    .post("/api/auth/resend-verification", "v2.auth.resendVerification.disabled")
    .global()
    .at((ctx) => ({ path: "/api/auth/resend-verification", body: { email: EXERCISE_EMAIL } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === false, "resend verification is disabled and must answer ok:false")
      },
      "status",
    ),
  http.protected
    .patch("/api/auth/profile", "v2.auth.updateProfile")
    .global()
    .protectedJwt()
    .mutating()
    .seeded((ctx) => authSeed(ctx))
    .at((ctx) => ({
      path: "/api/auth/profile",
      headers: bearer(ctx.state.accessToken),
      body: { username: "exercise_renamed" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body.user)
        check(body.user.username === "exercise_renamed", "profile update should apply the new username")
      },
      "status",
    ),
  // ---------------------------------------------------------------------------
  // v2 preferences: server-backed scoped key/value storage.
  // ---------------------------------------------------------------------------
  http.protected
    .get("/api/prefs/{scope}", "v2.prefs.list")
    .global()
    .at((ctx) => ({ path: route("/api/prefs/{scope}", { scope: "exercise" }) }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
      },
      "status",
    ),
  http.protected
    .put("/api/prefs/{scope}", "v2.prefs.set")
    .global()
    .mutating()
    .at((ctx) => ({
      path: route("/api/prefs/{scope}", { scope: "exercise" }),
      body: { name: "tone", value: "concise" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body.data)
        check(body.data.name === "tone", "prefs set should echo the name")
        check(body.data.value === "concise", "prefs set should echo the value")
      },
      "status",
    ),
  http.protected
    .delete("/api/prefs/{scope}/{name}", "v2.prefs.delete")
    .global()
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const seeded = yield* ctx.request({
          path: "/api/prefs/exercise",
          method: "PUT",
          body: { name: "tone", value: "concise" },
        })
        if (seeded.status !== 200) throw new Error(`seed prefs set failed: ${seeded.status} ${seeded.text}`)
        return { scope: "exercise", name: "tone" }
      }),
    )
    .at((ctx) => ({
      path: route("/api/prefs/{scope}/{name}", { scope: ctx.state.scope, name: ctx.state.name }),
    }))
    // The handler returns HttpApiSchema.NoContent but the wire response is currently
    // 200 with an empty body (spec says 204) — assert the shipped behavior and keep
    // the drift visible here until the schema-error layer maps Void to 204.
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.text === "", "prefs delete should return an empty body")
        }),
      "status",
    ),
  http.protected
    .delete("/api/prefs/{scope}", "v2.prefs.deleteScope")
    .global()
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        for (const name of ["one", "two"]) {
          const seeded = yield* ctx.request({
            path: "/api/prefs/exercise",
            method: "PUT",
            body: { name, value: name },
          })
          if (seeded.status !== 200) throw new Error(`seed prefs set failed: ${seeded.status} ${seeded.text}`)
        }
        return { scope: "exercise" }
      }),
    )
    .at((ctx) => ({ path: route("/api/prefs/{scope}", { scope: ctx.state.scope }) }))
    // Same 200-empty vs declared-204 drift as v2.prefs.delete (see above).
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.text === "", "prefs scope delete should return an empty body")
        }),
      "status",
    ),
  // ---------------------------------------------------------------------------
  // v2 autonomous tasks (draft-10 P4): the curl surface over AgentTask.
  // ---------------------------------------------------------------------------
  http.protected
    .post("/api/v1/tasks", "v2.task.create")
    .global()
    .mutating()
    .at((ctx) => ({
      path: "/api/v1/tasks",
      body: { prompt: "exercise task: summarize the README", autoRun: false, source: "user" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body.data)
        check(typeof body.data.id === "string" && body.data.id.startsWith("task_"), "create should return a task id")
        check(typeof body.data.sessionID === "string" && body.data.sessionID.length > 0, "create should back the task with a session")
        check(body.data.status === "paused", "a task without autoRun should start paused")
        check(body.data.prompt === "exercise task: summarize the README", "create should persist the prompt")
      },
      "status",
    ),
  http.protected
    .get("/api/v1/tasks", "v2.task.list")
    .global()
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
      },
      "status",
    ),
  http.protected
    .get("/api/v1/tasks/{id}", "v2.task.get")
    .global()
    .seeded((ctx) => taskSeed(ctx, "exercise task: get by id"))
    .at((ctx) => ({ path: route("/api/v1/tasks/{id}", { id: ctx.state.id }) }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        object(body.data)
        check(body.data.id === ctx.state.id, "get should return the seeded task")
        check(body.data.status === "paused", "the seeded task should still be paused")
      },
      "status",
    ),
  http.protected
    .patch("/api/v1/tasks/{id}", "v2.task.update")
    .global()
    .mutating()
    .seeded((ctx) => taskSeed(ctx, "exercise task: before update"))
    .at((ctx) => ({
      path: route("/api/v1/tasks/{id}", { id: ctx.state.id }),
      body: { prompt: "exercise task: after update" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body.data)
        check(body.data.prompt === "exercise task: after update", "update should apply the new prompt")
      },
      "status",
    ),
  http.protected
    .delete("/api/v1/tasks/{id}", "v2.task.cancel")
    .global()
    .mutating()
    .seeded((ctx) => taskSeed(ctx, "exercise task: cancel me"))
    .at((ctx) => ({ path: route("/api/v1/tasks/{id}", { id: ctx.state.id }) }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === true, "cancel should acknowledge")
      },
      "status",
    ),
  http.protected
    .post("/api/v1/tasks/{id}/pause", "v2.task.pause")
    .global()
    .mutating()
    .seeded((ctx) => taskSeed(ctx, "exercise task: pause me"))
    .at((ctx) => ({ path: route("/api/v1/tasks/{id}/pause", { id: ctx.state.id }) }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === true, "pause should acknowledge")
      },
      "status",
    ),
  http.protected
    .post("/api/v1/tasks/{id}/resume", "v2.task.resume")
    .global()
    .mutating()
    .seeded((ctx) => taskSeed(ctx, "exercise task: resume me"))
    .at((ctx) => ({ path: route("/api/v1/tasks/{id}/resume", { id: ctx.state.id }) }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === true, "resume should acknowledge and queue the task")
      },
      "status",
    ),
  http.protected
    .post("/api/v1/tasks/{id}/run", "v2.task.run")
    .global()
    .mutating()
    .seeded((ctx) => taskSeed(ctx, "exercise task: run me"))
    .at((ctx) => ({ path: route("/api/v1/tasks/{id}/run", { id: ctx.state.id }) }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === true, "run should report that the task was started (a paused task is a no-op)")
      },
      "status",
    ),
  http.protected
    .post("/api/v1/tasks/{id}/generate", "v2.task.generate")
    .global()
    .mutating()
    .seeded((ctx) => taskSeed(ctx, "exercise task: generate me"))
    .at((ctx) => ({ path: route("/api/v1/tasks/{id}/generate", { id: ctx.state.id }) }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.ok === true, "generate should acknowledge (generator failures are recorded, not surfaced)")
      },
      "status",
    ),
  http.protected
    .get("/api/v1/tasks/{id}/events", "v2.task.events")
    .global()
    .seeded((ctx) => taskSeed(ctx, "exercise task: events"))
    .at((ctx) => ({ path: route("/api/v1/tasks/{id}/events", { id: ctx.state.id }) }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        check(body.data.length === 0, "a fresh task should have no hook events")
      },
      "status",
    ),
  http.protected
    .get("/session", "session.list")
    .seeded((ctx) => ctx.session({ title: "List me" }))
    .at((ctx) => ({ path: "/session?roots=true", headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id && item.title === "List me"),
        "seeded session should be listed",
      )
    }),
  http.protected
    .get("/session/status", "session.status")
    .seeded((ctx) => ctx.session({ title: "Status session" }))
    .json(200, object),
  http.protected
    .post("/session", "session.create")
    .mutating()
    .at((ctx) => ({ path: "/session", headers: ctx.headers(), body: { title: "Created session" } }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.title === "Created session", "created session should use requested title")
        check(body.directory === ctx.directory, "created session should use scenario directory")
      },
      "status",
    ),
  http.protected
    .get("/session/{sessionID}", "session.get")
    .seeded((ctx) => ctx.session({ title: "Get me" }))
    .at((ctx) => ({ path: route("/session/{sessionID}", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "should return requested session")
      check(body.title === "Get me", "should preserve seeded title")
    }),
  http.protected
    .get("/session/{sessionID}", "session.get.missing")
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .patch("/session/{sessionID}", "session.update")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Before rename" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { title: "After rename" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.title === "After rename", "updated session should use new title")
      },
      "status",
    ),
  http.protected
    .patch("/session/{sessionID}", "session.update.invalid")
    .mutating()
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
      body: { title: 1 },
    }))
    .status(400),
  http.protected
    .delete("/session/{sessionID}", "session.delete")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Delete me" }))
    .at((ctx) => ({ path: route("/session/{sessionID}", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete should return true")
        check((yield* ctx.sessionGet(ctx.state.id)) === undefined, "deleted session should not remain in storage")
      }),
    ),
  http.protected
    .get("/session/{sessionID}/children", "session.children")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const parent = yield* ctx.session({ title: "Parent" })
        const child = yield* ctx.session({ title: "Child", parentID: parent.id })
        return { parent, child }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/children", { sessionID: ctx.state.parent.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.child.id && item.parentID === ctx.state.parent.id),
        "children should include seeded child",
      )
    }),
  http.protected
    .get("/session/{sessionID}/todo", "session.todo")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Todo session" })
        const todos = [{ content: "cover session todo", status: "pending", priority: "high" }]
        yield* ctx.todos(session.id, todos)
        return { session, todos }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/todo", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      check(stable(body) === stable(ctx.state.todos), "todos should match seeded state")
    }),
  http.protected
    .get("/session/{sessionID}/diff", "session.diff")
    .seeded((ctx) => ctx.session({ title: "Diff session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/diff", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/session/{sessionID}/message", "session.messages")
    .seeded((ctx) => ctx.session({ title: "Messages session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/message", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 0, "new session should have no messages")
    }),
  http.protected
    .get("/session/{sessionID}/message/{messageID}", "session.message")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Message get session" })
        const message = yield* ctx.message(session.id, { text: "read me" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
      }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(isRecord(body.info) && body.info.id === ctx.state.message.info.id, "should return requested message")
      check(
        Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.id === ctx.state.message.part.id),
        "message should include seeded part",
      )
    }),
  http.protected
    .patch("/session/{sessionID}/message/{messageID}/part/{partID}", "part.update")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Part update session" })
        const message = yield* ctx.message(session.id, { text: "before" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}/part/{partID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
        partID: ctx.state.message.part.id,
      }),
      headers: ctx.headers(),
      body: { ...ctx.state.message.part, text: "after" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.type === "text" && body.text === "after", "updated part should be returned")
      },
      "status",
    ),
  http.protected
    .delete("/session/{sessionID}/message/{messageID}/part/{partID}", "part.delete")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Part delete session" })
        const message = yield* ctx.message(session.id, { text: "delete part" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}/part/{partID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
        partID: ctx.state.message.part.id,
      }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete part should return true")
        const messages = yield* ctx.messages(ctx.state.session.id)
        check(messages[0]?.parts.length === 0, "deleted part should not remain on message")
      }),
    ),
  http.protected
    .delete("/session/{sessionID}/message/{messageID}", "session.deleteMessage")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Message delete session" })
        const message = yield* ctx.message(session.id, { text: "delete message" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
      }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete message should return true")
        check((yield* ctx.messages(ctx.state.session.id)).length === 0, "deleted message should not remain")
      }),
    ),
  http.protected
    .post("/session/{sessionID}/fork", "session.fork")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Fork source" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/fork", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.id === "string", "fork should return a session")
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/abort", "session.abort")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Abort session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/abort", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body) => {
      check(body === true, "abort should return true")
    }),
  http.protected
    .post("/session/{sessionID}/abort", "session.abort.missing")
    .at((ctx) => ({
      path: route("/session/{sessionID}/abort", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "missing session abort should remain a no-op success")
    }),
  http.protected
    .post("/session/{sessionID}/init", "session.init")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Init session" })
        const message = yield* ctx.message(session.id, { text: "initialize" })
        yield* ctx.llmText("initialized")
        yield* ctx.llmText("initialized")
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/init", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      body: { providerID: "test", modelID: "test-model", messageID: ctx.state.message.info.id },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "init should return true")
        yield* ctx.llmWait(1)
      }),
    ),
  http.protected
    .post("/session/{sessionID}/message", "session.prompt")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "LLM prompt session" })
        yield* ctx.llmText("fake assistant")
        yield* ctx.llmText("fake assistant")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        parts: [{ type: "text", text: "hello llm" }],
      },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(isRecord(body.info) && body.info.role === "assistant", "prompt should return assistant message")
          check(
            Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.text === "fake assistant"),
            "assistant message should use fake LLM text",
          )
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/prompt_async", "session.prompt_async")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Async prompt session" })
        yield* ctx.llmText("fake async assistant")
        yield* ctx.llmText("fake async assistant")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/prompt_async", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        parts: [{ type: "text", text: "hello async" }],
      },
    }))
    .status(204, (ctx) =>
      Effect.gen(function* () {
        yield* ctx.llmWait(1)
      }),
    ),
  http.protected
    .post("/session/{sessionID}/command", "session.command")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Command session" })
        yield* ctx.llmText("command done")
        yield* ctx.llmText("command done")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/command", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { command: "init", arguments: "", model: "test/test-model" },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(isRecord(body.info) && body.info.role === "assistant", "command should return assistant message")
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/shell", "session.shell")
    .preserveDatabase()
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Shell session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/shell", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { agent: "build", model: { providerID: "test", modelID: "test-model" }, command: "printf shell-ok" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(isRecord(body.info) && body.info.role === "assistant", "shell should return assistant message")
        check(
          Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.type === "tool"),
          "shell should return a tool part",
        )
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/summarize", "session.summarize")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Summarize session" })
        yield* ctx.message(session.id, { text: "summarize this work" })
        const summary = [
          "## Goal",
          "- Exercise session summarize.",
          "",
          "## Constraints & Preferences",
          "- Use fake LLM.",
          "",
          "## Progress",
          "### Done",
          "- Summary generated.",
          "",
          "### In Progress",
          "- (none)",
          "",
          "### Blocked",
          "- (none)",
          "",
          "## Key Decisions",
          "- Keep route local.",
          "",
          "## Next Steps",
          "- (none)",
          "",
          "## Critical Context",
          "- Test fixture.",
          "",
          "## Relevant Files",
          "- test/server/httpapi-exercise/index.ts: scenario",
        ].join("\n")
        yield* ctx.llmText(summary)
        yield* ctx.llmText(summary)
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/summarize", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { providerID: "test", modelID: "test-model", auto: false },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          check(body === true, "summarize should return true")
          const messages = yield* ctx.messages(ctx.state.id)
          check(
            messages.some((message) => message.info.role === "assistant" && message.info.summary === true),
            "summarize should create a summary assistant message",
          )
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/revert", "session.revert")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Revert session" })
        const message = yield* ctx.message(session.id, { text: "revert me" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/revert", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      body: { messageID: ctx.state.message.info.id },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.session.id, "revert should return the session")
        check(
          isRecord(body.revert) && body.revert.messageID === ctx.state.message.info.id,
          "revert should record reverted message",
        )
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/unrevert", "session.unrevert")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Unrevert session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/unrevert", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "unrevert should return the session")
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/permissions/{permissionID}", "permission.respond")
    .seeded((ctx) => ctx.session({ title: "Deprecated permission session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/permissions/{permissionID}", {
        sessionID: ctx.state.id,
        permissionID: "per_httpapi_deprecated",
      }),
      headers: ctx.headers(),
      body: { response: "once" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/session/{sessionID}/share", "session.share")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Share session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/share", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "share should return the session")
      },
      "status",
    ),
  http.protected
    .delete("/session/{sessionID}/share", "session.unshare")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Unshare session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/share", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "unshare should return the session")
      },
      "status",
    ),
  http.protected
    .get("/session/{sessionID}/anchor", "session.anchor")
    .seeded((ctx) => ctx.session({ title: "Anchor session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/anchor", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.anchors)
        check(body.anchors.length === 0, "a session without compaction should report no anchors yet")
      },
      "status",
    ),
  // ---------------------------------------------------------------------------
  // Targeted Learning: setup, settings, system probes, books, ingest jobs,
  // retrieval inspector, and student memory. books.db and the TL data dir are
  // per-process (XDG-isolated) and survive the per-scenario database reset, so
  // these scenarios assert shapes rather than absolute emptiness and are
  // ordered to keep state dependencies explicit.
  // ---------------------------------------------------------------------------
  http.protected
    .get("/targeted-learning/setup", "targetedLearning.setup.status")
    .json(
      200,
      (body) => {
        object(body)
        check(
          ["not-started", "in-progress", "ready", "needs-repair"].includes(body.status),
          `setup status should be a known literal, got ${body.status}`,
        )
        array(body.steps)
        for (const step of body.steps) {
          object(step)
          check(typeof step.name === "string", "setup steps should have names")
          check(
            ["pending", "running", "complete", "failed", "skipped"].includes(step.status),
            "setup steps should report known statuses",
          )
          check(typeof step.attempts === "number", "setup steps should count attempts")
        }
      },
      "status",
    ),
  http.protected
    .post("/targeted-learning/setup/cancel", "targetedLearning.setup.cancel")
    .mutating()
    .json(
      200,
      (body) => {
        object(body)
        array(body.steps)
      },
      "status",
    ),
  http.protected
    .post("/targeted-learning/setup/repair", "targetedLearning.setup.repair")
    .mutating()
    .json(
      200,
      (body) => {
        object(body)
        array(body.steps)
        check(
          body.steps.every((step: JsonObject) => step.status === "pending"),
          "repair should reset every step to pending",
        )
      },
      "status",
    ),
  http.protected
    .post("/targeted-learning/setup/import-local", "targetedLearning.setup.importLocal.missing")
    .at((ctx) => ({ path: "/targeted-learning/setup/import-local", headers: ctx.headers(), body: { folder: "/tmp/exercise-no-such-folder" } }))
    .status(400),
  http.protected
    .post("/targeted-learning/setup/start", "targetedLearning.setup.start")
    .probe({ path: "/targeted-learning/setup/start", body: { force: 1 } })
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        // Point the download pipeline at a local server that always answers 404 so the
        // setup fiber fails terminally within the exercise instead of downloading a model.
        const server = Bun.serve({
          port: 0,
          fetch: () => new Response("exercise: downloads are blocked", { status: 404 }),
        })
        yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(server.stop(true))))
        const patched = yield* ctx.request({
          path: "/targeted-learning/settings",
          method: "PATCH",
          headers: ctx.headers(),
          body: { download: { endpoint: `http://127.0.0.1:${server.port}` } },
        })
        if (patched.status !== 200) throw new Error(`seed download endpoint patch failed: ${patched.status} ${patched.text}`)
        return { url: `http://127.0.0.1:${server.port}` }
      }),
    )
    .at((ctx) => ({ path: "/targeted-learning/setup/start", headers: ctx.headers(), body: {} }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          array(body.steps)
          check(
            ["not-started", "in-progress", "ready", "needs-repair"].includes(body.status),
            `setup start should return a known status, got ${body.status}`,
          )
          // Give the probe → preflight → download fiber a moment, then confirm it did NOT
          // complete against the blocked endpoint and restore the default endpoint.
          yield* Effect.sleep("1200 millis")
          const status = yield* ctx.request({ path: "/targeted-learning/setup", headers: ctx.headers() })
          if (status.status !== 200) throw new Error(`setup status after start failed: ${status.status}`)
          object(status.body)
          check(status.body.status !== "ready", "setup must not become ready while downloads are blocked")
          const restored = yield* ctx.request({
            path: "/targeted-learning/settings",
            method: "PATCH",
            headers: ctx.headers(),
            body: { download: {} },
          })
          if (restored.status !== 200) throw new Error(`download endpoint restore failed: ${restored.status}`)
        }),
      "status",
    ),
  http.protected
    .get("/targeted-learning/settings", "targetedLearning.settings.get")
    .json(
      200,
      (body) => {
        object(body)
        object(body.values)
        object(body.effective)
        check(
          Object.values(body.effective).every((entry) => isRecord(entry) && "value" in entry && "source" in entry),
          "effective settings should tag every leaf with a source",
        )
      },
      "status",
    ),
  http.protected
    .patch("/targeted-learning/settings", "targetedLearning.settings.update")
    .mutating()
    .at((ctx) => ({ path: "/targeted-learning/settings", headers: ctx.headers(), body: { maxBookSizeMB: 150 } }))
    .json(
      200,
      (body) => {
        object(body)
        object(body.values)
        check(body.values.maxBookSizeMB === 150, "settings update should apply the new value")
        check(isRecord(body.effective["maxBookSizeMB"]), "effective settings should include the patched leaf")
      },
      "status",
    ),
  http.protected
    .get("/targeted-learning/settings/schema", "targetedLearning.settings.schema")
    .json(
      200,
      (body) => {
        object(body)
        object(body.properties)
      },
      "status",
    ),
  http.protected
    .get("/targeted-learning/settings/presets", "targetedLearning.settings.presets")
    .json(
      200,
      (body) => {
        object(body)
        for (const key of ["low", "balanced", "high"]) check(isRecord(body[key]), `preset ${key} should exist`)
      },
      "status",
    ),
  http.protected
    .get("/targeted-learning/health", "targetedLearning.health")
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.setupStatus === "string", "health should report the setup status")
        check(typeof body.booksDbAvailable === "boolean", "health should report books.db availability")
        check(typeof body.modelReady === "boolean", "health should report model readiness")
        check(body.manifestLoaded === true, "the pinned manifest means setup is always possible")
      },
      "status",
    ),
  http.protected
    .get("/targeted-learning/debug/status", "targetedLearning.debug.status")
    .json(200, object, "status"),
  http.protected
    .get("/targeted-learning/probe", "targetedLearning.probe")
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.cpuCores === "number" && body.cpuCores > 0, "probe should detect the CPU")
        check(typeof body.totalMemoryMB === "number", "probe should report memory")
        check(typeof body.freeDiskMB === "number", "probe should report free disk")
        check(typeof body.dataDirWritable === "boolean", "probe should verify the data dir")
        check(
          ["low", "balanced", "high"].includes(body.recommendedProfile),
          "probe should recommend a profile",
        )
      },
      "status",
    ),
  http.protected
    .get("/targeted-learning/books", "targetedLearning.books.list")
    .json(
      200,
      (body) => {
        object(body)
        array(body.books)
        for (const book of body.books) {
          object(book)
          check(typeof book.id === "string", "books should have ids")
          check(typeof book.status === "string", "books should report indexing status")
        }
      },
      "status",
    ),
  http.protected
    .post("/targeted-learning/books", "targetedLearning.books.upload")
    .mutating()
    .at((ctx) => ({
      path: "/targeted-learning/books",
      headers: ctx.headers(),
      body: {
        filename: "exercise-upload.txt",
        contentBase64: Buffer.from("Exercise uploaded book.\n").toString("base64"),
        title: "Exercise Upload",
      },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.bookId === "string" && body.bookId.length > 0, "upload should register the book")
        check(typeof body.slug === "string" && body.slug.length > 0, "upload should derive a slug")
        check(body.duplicate === false, "a fresh upload is not a duplicate")
      },
      "status",
    ),
  http.protected
    .post("/targeted-learning/books/import", "targetedLearning.books.import")
    .mutating()
    .seeded((ctx) => ctx.file("exercise-import.txt", "Exercise imported book.\n"))
    .at((ctx) => ({
      path: "/targeted-learning/books/import",
      headers: ctx.headers(),
      body: { path: `${ctx.directory}/exercise-import.txt`, title: "Exercise Import" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.bookId === "string" && body.bookId.length > 0, "import should register the book")
        check(body.duplicate === false, "a fresh import is not a duplicate")
      },
      "status",
    ),
  http.protected
    .delete("/targeted-learning/books/{bookID}", "targetedLearning.books.delete")
    .mutating()
    .seeded((ctx) => bookUploadSeed(ctx, "Exercise Delete Me"))
    .at((ctx) => ({
      path: route("/targeted-learning/books/{bookID}", { bookID: ctx.state.bookId }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        check(body === true, "book delete should confirm removal")
      },
      "status",
    ),
  http.protected
    .get("/targeted-learning/jobs", "targetedLearning.jobs.list")
    .json(
      200,
      (body) => {
        object(body)
        array(body.jobs)
        for (const job of body.jobs) {
          object(job)
          check(typeof job.id === "string", "jobs should have ids")
          check(typeof job.status === "string", "jobs should report status")
          check(typeof job.progress === "number", "jobs should report progress")
        }
      },
      "status",
    ),
  http.protected
    .post("/targeted-learning/jobs/{jobID}/pause", "targetedLearning.jobs.pause.missing")
    .at((ctx) => ({
      path: route("/targeted-learning/jobs/{jobID}/pause", { jobID: "job_exercise_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === false, "pausing an unknown job should report false"), "status"),
  http.protected
    .post("/targeted-learning/jobs/{jobID}/resume", "targetedLearning.jobs.resume.missing")
    .at((ctx) => ({
      path: route("/targeted-learning/jobs/{jobID}/resume", { jobID: "job_exercise_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === false, "resuming an unknown job should report false"), "status"),
  http.protected
    .post("/targeted-learning/jobs/{jobID}/cancel", "targetedLearning.jobs.cancel.missing")
    .at((ctx) => ({
      path: route("/targeted-learning/jobs/{jobID}/cancel", { jobID: "job_exercise_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === false, "cancelling an unknown job should report false"), "status"),
  http.protected
    .post("/targeted-learning/jobs/{jobID}/retry", "targetedLearning.jobs.retry.missing")
    .at((ctx) => ({
      path: route("/targeted-learning/jobs/{jobID}/retry", { jobID: "job_exercise_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === false, "retrying an unknown job should report false"), "status"),
  http.protected
    .post("/targeted-learning/search", "targetedLearning.search")
    .at((ctx) => ({
      path: "/targeted-learning/search",
      headers: ctx.headers(),
      body: { query: "what is photosynthesis?" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.decision === "string", "the inspector should report a gate decision")
        check(typeof body.lang === "string", "the inspector should report the detected language")
        array(body.candidates)
        check(isRecord(body.thresholds), "the inspector should report the active thresholds")
      },
      "status",
    ),
  http.protected
    .get("/targeted-learning/memory", "targetedLearning.memory.list")
    .json(
      200,
      (body) => {
        object(body)
        array(body.student)
        array(body.notes)
        for (const memory of body.student) {
          object(memory)
          check(typeof memory.id === "string" && typeof memory.text === "string", "student memories should have id and text")
          check(typeof memory.pinned === "boolean", "student memories should report pinned")
        }
        for (const note of body.notes) {
          object(note)
          check(typeof note.id === "string" && typeof note.bookId === "string", "book notes should have id and bookId")
        }
      },
      "status",
    ),
  http.protected
    .post("/targeted-learning/memory/student/{memoryID}/pin", "targetedLearning.memory.student.pin")
    .mutating()
    .seeded((ctx) => studentMemorySeed(ctx, "exercise goal: read one chapter per week"))
    .at((ctx) => ({
      path: route("/targeted-learning/memory/student/{memoryID}/pin", { memoryID: ctx.state.memoryID }),
      headers: ctx.headers(),
      body: { pinned: true },
    }))
    .json(
      200,
      (body) => {
        check(body === true, "pinning a seeded memory should confirm")
      },
      "status",
    ),
  http.protected
    .delete("/targeted-learning/memory/student/{memoryID}", "targetedLearning.memory.student.delete")
    .mutating()
    .seeded((ctx) => studentMemorySeed(ctx, "exercise goal: delete me"))
    .at((ctx) => ({
      path: route("/targeted-learning/memory/student/{memoryID}", { memoryID: ctx.state.memoryID }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        check(body === true, "deleting a seeded memory should confirm")
      },
      "status",
    ),
  http.protected
    .delete("/targeted-learning/memory/notes/{noteID}", "targetedLearning.memory.note.delete")
    .mutating()
    .seeded((ctx) => bookNoteSeed(ctx))
    .at((ctx) => ({
      path: route("/targeted-learning/memory/notes/{noteID}", { noteID: ctx.state.noteID }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        check(body === true, "deleting a seeded book note should confirm")
      },
      "status",
    ),
  http.protected
    .post("/tui/append-prompt", "tui.appendPrompt")
    .at((ctx) => ({ path: "/tui/append-prompt", headers: ctx.headers(), body: { text: "hello" } }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/select-session", "tui.selectSession.invalid")
    .at((ctx) => ({ path: "/tui/select-session", headers: ctx.headers(), body: { sessionID: "invalid" } }))
    .status(400),
  http.protected.post("/tui/open-help", "tui.openHelp").json(200, boolean, "status"),
  http.protected.post("/tui/open-sessions", "tui.openSessions").json(200, boolean, "status"),
  http.protected.post("/tui/open-themes", "tui.openThemes").json(200, boolean, "status"),
  http.protected.post("/tui/open-models", "tui.openModels").json(200, boolean, "status"),
  http.protected.post("/tui/submit-prompt", "tui.submitPrompt").json(200, boolean, "status"),
  http.protected.post("/tui/clear-prompt", "tui.clearPrompt").json(200, boolean, "status"),
  http.protected
    .post("/tui/execute-command", "tui.executeCommand")
    .at((ctx) => ({ path: "/tui/execute-command", headers: ctx.headers(), body: { command: "agent_cycle" } }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/show-toast", "tui.showToast")
    .at((ctx) => ({
      path: "/tui/show-toast",
      headers: ctx.headers(),
      body: { title: "Exercise", message: "covered", variant: "info", duration: 1000 },
    }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/publish", "tui.publish")
    .at((ctx) => ({
      path: "/tui/publish",
      headers: ctx.headers(),
      body: { type: "tui.prompt.append", properties: { text: "published" } },
    }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/select-session", "tui.selectSession")
    .seeded((ctx) => ctx.session({ title: "TUI select" }))
    .at((ctx) => ({ path: "/tui/select-session", headers: ctx.headers(), body: { sessionID: ctx.state.id } }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/control/response", "tui.control.response")
    .at((ctx) => ({ path: "/tui/control/response", headers: ctx.headers(), body: { ok: true } }))
    .json(200, boolean, "status"),
  http.protected
    .get("/tui/control/next", "tui.control.next")
    .mutating()
    .seeded((ctx) => ctx.tuiRequest({ path: "/tui/exercise", body: { text: "queued" } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.path === "/tui/exercise", "control next should return queued path")
        object(body.body)
        check(body.body.text === "queued", "control next should return queued body")
      },
      "status",
    ),
  http.protected
    .post("/global/upgrade", "global.upgrade")
    .global()
    .probe({ path: "/global/upgrade", body: { target: 1 } })
    .at(() => ({ path: "/global/upgrade", body: { target: 1 } }))
    .status(400),
  http.protected
    .get("/global/features", "global.features")
    .global()
    .json(
      200,
      (body) => {
        object(body)
        object(body.features)
        for (const key of ["memory", "mcp", "lsp", "profiler"])
          check(typeof body.features[key] === "boolean", `feature flag ${key} should be a boolean`)
        array(body.envDisabled)
        check(typeof body.lspEnabled === "boolean", "lspEnabled should be a boolean")
        array(body.lspServers)
        for (const server of body.lspServers) {
          object(server)
          check(typeof server.id === "string", "LSP servers should have ids")
          array(server.extensions)
          check(typeof server.disabled === "boolean", "LSP servers should report disabled state")
        }
        object(body.performance)
        check(typeof body.performance.keepProjectsWarm === "boolean", "keepProjectsWarm should be a boolean")
        object(body.probes)
        check(typeof body.probes.fts5 === "string" && typeof body.probes.ssh2 === "string", "probes should report runtime capabilities")
      },
      "status",
    ),
  http.protected
    .post("/global/restart", "global.restart")
    .global()
    // POST /global/restart declares no payload schema, so EVERY authenticated call reaches
    // the handler: it re-execs the current entrypoint (for the exerciser: this very script)
    // and schedules a real process.exit 500ms later. An auth-mode probe would therefore
    // fork-bomb the run, so the scenario only participates in coverage + effect mode, where
    // the seed stubs process.exit and redirects the re-exec target to a no-op script first.
    .onlyIn("coverage", "effect")
    .mutating()
    .seeded(() =>
      Effect.gen(function* () {
        const noOpScript = path.join(exerciseGlobalRoot, "restart-child.ts")
        yield* Effect.promise(() => Bun.write(noOpScript, "process.exit(0)\n"))
        const originalExit = process.exit
        const holder = { exitRequested: undefined as number | undefined }
        Object.defineProperty(process, "exit", {
          value: (code?: number) => {
            holder.exitRequested = code ?? 0
          },
          configurable: true,
          writable: true,
        })
        const originalArgv = [...process.argv]
        process.argv = [originalArgv[0]!, noOpScript]
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            Object.defineProperty(process, "exit", { value: originalExit, configurable: true, writable: true })
            process.argv = originalArgv
          }),
        )
        return holder
      }),
    )
    .at((ctx) => ({ path: "/global/restart" }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(body.started === true, "restart should report that the replacement process was started")
          // The scheduled exit fires ~500ms after the response; scenarios run sequentially,
          // so the stub is still installed when it fires.
          yield* Effect.sleep("700 millis")
          check(ctx.state.exitRequested === 0, "the restart should have scheduled a process exit")
        }),
      "status",
    ),
]

const llmScenarios = new Set([
  "session.init",
  "session.prompt",
  "session.prompt_async",
  "session.command",
  "session.summarize",
])

const main = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.promise(() => disposeApps()).pipe(Effect.andThen(cleanupExercisePaths)))
  const options = parseOptions(Bun.argv.slice(2))
  const modules = yield* Effect.promise(() => runtime())
  const effectRoutes = routeKeys(OpenApi.fromApi(modules.PublicApi))
  const selected = selectedScenarios(options, scenarios)
  const missing = effectRoutes.filter((route) => !scenarios.some((scenario) => route === routeKey(scenario)))
  const extra = scenarios.filter((scenario) => !effectRoutes.includes(routeKey(scenario)))

  for (const scenario of scenarios) {
    if (scenario.kind === "active" && llmScenarios.has(scenario.name) && !scenario.project?.llm) {
      return yield* Effect.fail(new Error(`${scenario.name} must use TestLLMServer via .withLlm()`))
    }
  }

  printHeader(options, effectRoutes, selected, missing, extra, {
    database: exerciseDatabasePath,
    global: exerciseGlobalRoot,
  })

  const results =
    options.mode === "coverage"
      ? selected.map(coverageResult)
      : yield* Effect.forEach(
          selected,
          (scenario) =>
            Effect.gen(function* () {
              if (options.progress) console.log(`${color.dim}RUN ${routeKey(scenario)} ${scenario.name}${color.reset}`)
              return yield* runScenario(options)(scenario)
            }),
          { concurrency: 1 },
        )
  printResults(results, missing, extra)

  if (results.some((result) => result.status === "fail"))
    return yield* Effect.fail(new Error("one or more scenarios failed"))
  if (options.failOnSkip && results.some((result) => result.status === "skip"))
    return yield* Effect.fail(new Error("one or more scenarios are skipped"))
  if (options.failOnMissing && missing.length > 0)
    return yield* Effect.fail(new Error("one or more routes have no scenario"))
  return undefined
})

Effect.runPromise(main.pipe(Effect.provide(TestLLMServer.layer), Effect.scoped) as Effect.Effect<undefined, unknown, never>).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`${color.red}${message(error)}${color.reset}`)
    process.exit(1)
  },
)
