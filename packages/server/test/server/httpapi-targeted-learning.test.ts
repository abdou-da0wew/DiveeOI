// Integration tests for the /targeted-learning HTTP route group
// (packages/server/src/server/routes/instance/httpapi/groups/targeted-learning.ts).
//
// Pattern: the FULL production route tree is mounted on a real web handler —
// the deepest offline-testable level found in the infra survey (same topology
// as test/server/httpapi-exercise/backend.ts, which exercises HttpApiApp.routes
// through HttpRouter.toWebHandler). Real middleware (Authorization +
// InstanceContext + WorkspaceRouting), real TL handlers, real books.db and a
// real global config file — all isolated into a throw-away XDG root by the
// sibling `./tl-env` fixture (which MUST stay the first import).
//
// Offline constraints (documented, not hidden):
// - The embedding model (~600 MB) is not downloaded in the sandbox, so a book
//   upload fails in the background with "Embedding model … is not downloaded".
//   The tests assert that deterministic failure instead of successful indexing.
//   The success path (parse → OCR → chunk → embed → searchable) is covered at
//   service level in packages/learning/test/ocr-e2e.test.ts using the
//   startIngest embedFn/ensureFn test seams.
// - RemoteSession: 4-h found the production route graph unable to resolve
//   `@diveeoi/RemoteSession` and worked around it here with an explicit
//   `Layer.provide(RemoteSession.defaultLayer)`. Fixed in 4-k by adding
//   `RemoteSession.node` to `AppServices.serviceNodes` — the plain production
//   graph now resolves it, so the workaround is removed.
import "./tl-env"

import { describe, expect, afterAll, test } from "bun:test"
import { Config, ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { globalConfigFile, testDirectory, cleanupTestRoot } from "./tl-env"
import { disposeAllInstances } from "../fixture/fixture"

const BASIC = "Basic " + Buffer.from("DIVEEI:secret").toString("base64")

// Boot once per file; the layer build takes ~2 s and the first request warms
// the lazily-built service graph (~2 s more).
const web = HttpRouter.toWebHandler(
  HttpApiApp.routes.pipe(
    // Basic-auth credentials, same mechanism as httpapi-exercise/backend.ts.
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: "secret", OPENCODE_SERVER_USERNAME: "DIVEEI" }),
      ),
    ),
  ),
  { disableLogger: true },
)

const instanceDir = (() => {
  mkdirSync(testDirectory, { recursive: true })
  return testDirectory
})()

function request(pathname: string, init?: RequestInit) {
  const url = new URL(pathname, "http://localhost")
  url.searchParams.set("directory", instanceDir)
  return new Request(url, {
    ...init,
    headers: { authorization: BASIC, ...(init?.headers ?? {}) },
  })
}

async function call(pathname: string, init?: RequestInit): Promise<{ status: number; body: any; text: string }> {
  const res = await web.handler(request(pathname, init), (HttpApiApp as any).context)
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    // raw body
  }
  return { status: res.status, body, text }
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

/** Poll the book list until the book reaches a terminal ingest status. */
async function bookTerminal(bookId: string): Promise<{ id: string; status: string; error?: string }> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call("/targeted-learning/books")
    const row = (body?.books ?? []).find((b: { id: string }) => b.id === bookId)
    if (row && ["failed", "ready", "cancelled"].includes(row.status)) return row
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`book ${bookId} never reached a terminal status`)
}

/** Poll the job list until the given job reaches a terminal status. */
async function jobTerminal(jobId: string): Promise<{ id: string; bookId: string; status: string; error?: string }> {
  for (let i = 0; i < 200; i++) {
    const { body } = await call("/targeted-learning/jobs")
    const row = (body?.jobs ?? []).find((j: { id: string }) => j.id === jobId)
    if (row && ["failed", "complete", "cancelled"].includes(row.status)) return row
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`job ${jobId} never reached a terminal status`)
}

afterAll(async () => {
  await disposeAllInstances().catch(() => undefined)
  web.dispose()
  cleanupTestRoot()
})

// Long timeout: the route tree boots lazily on the first request.
const HTTP_TIMEOUT = 120_000

describe("GET /targeted-learning — reads", () => {
  test("books list is an empty array on a fresh library", async () => {
    const { status, body } = await call("/targeted-learning/books")
    expect(status).toBe(200)
    expect(body).toEqual({ books: [] })
  }, HTTP_TIMEOUT)

  test("health reports real books.db availability", async () => {
    const { status, body } = await call("/targeted-learning/health")
    expect(status).toBe(200)
    expect(typeof body.setupStatus).toBe("string")
    expect(body.booksDbAvailable).toBe(true)
    expect(body.manifestLoaded).toBe(true)
    expect(body.modelReady).toBe(false)
  }, HTTP_TIMEOUT)

  test("setup status exposes the 8-step pipeline", async () => {
    const { status, body } = await call("/targeted-learning/setup")
    expect(status).toBe(200)
    expect(["not-started", "in-progress", "ready", "needs-repair"]).toContain(body.status)
    expect(body.steps).toHaveLength(8)
    for (const step of body.steps) {
      expect(typeof step.name).toBe("string")
      expect(typeof step.attempts).toBe("number")
    }
  }, HTTP_TIMEOUT)

  test("settings returns defaults plus an effective map", async () => {
    const { status, body } = await call("/targeted-learning/settings")
    expect(status).toBe(200)
    expect(body.values.maxBookSizeMB).toBe(200)
    expect(body.values.ocr).toMatchObject({ enabled: false, languages: "ara+eng" })
    expect(body.values.embedding?.dtype).toBe("int8")
    // effective maps leaf paths to { value, source }
    expect(body.effective["maxBookSizeMB"]).toEqual({ value: 200, source: "default" })
    expect(typeof body.effective).toBe("object")
  }, HTTP_TIMEOUT)

  test("settings schema and presets respond", async () => {
    const schema = await call("/targeted-learning/settings/schema")
    expect(schema.status).toBe(200)
    expect(schema.body?.properties?.ocr).toBeDefined()
    const presets = await call("/targeted-learning/settings/presets")
    expect(presets.status).toBe(200)
    expect(Object.keys(presets.body)).toEqual(expect.arrayContaining(["low", "balanced", "high"]))
  }, HTTP_TIMEOUT)

  test("memory list starts empty", async () => {
    const { status, body } = await call("/targeted-learning/memory")
    expect(status).toBe(200)
    expect(body).toEqual({ student: [], notes: [] })
  }, HTTP_TIMEOUT)

  test("diagnostics snapshot and system probe respond", async () => {
    const debug = await call("/targeted-learning/debug/status")
    expect(debug.status).toBe(200)
    expect(typeof debug.body).toBe("object")
    const probe = await call("/targeted-learning/probe")
    expect(probe.status).toBe(200)
    // The probe runs locally (OS/arch/RAM/disk detection) — fully offline.
    expect(typeof probe.body).toBe("object")
  }, HTTP_TIMEOUT)

  test("setup cancel and repair are safe no-ops when nothing is running", async () => {
    const cancel = await call("/targeted-learning/setup/cancel", { method: "POST" })
    expect(cancel.status).toBe(200)
    expect(cancel.body.steps).toHaveLength(8)
    const repair = await call("/targeted-learning/setup/repair", { method: "POST" })
    expect(repair.status).toBe(200)
    expect(["not-started", "in-progress", "ready", "needs-repair"]).toContain(repair.body.status)
  }, HTTP_TIMEOUT)
})

describe("PATCH /targeted-learning/settings — per-section merge semantics", () => {
  test("patching one section preserves sibling sections", async () => {
    const { status, body } = await call("/targeted-learning/settings", json({ ocr: { enabled: true, languages: "eng" } }, "PATCH"))
    expect(status).toBe(200)
    // Patched section applied…
    expect(body.values.ocr).toMatchObject({ enabled: true, languages: "eng" })
    // …siblings untouched:
    expect(body.values.maxBookSizeMB).toBe(200)
    expect(body.values.embedding?.dtype).toBe("int8")
    expect(body.values.memory?.autoWrite).toBe("auto")
  }, HTTP_TIMEOUT)

  test("patching a section again keeps sibling keys inside that section (no clobber)", async () => {
    // Second PATCH sends only `languages` for the ocr section. The handler
    // shallow-merges at the TL top level, and the persisted global config write
    // deep-merges (patchJsonc), so `enabled: true` from the previous PATCH
    // survives instead of being reset to the default false.
    const { status, body } = await call("/targeted-learning/settings", json({ ocr: { languages: "ara+eng" } }, "PATCH"))
    expect(status).toBe(200)
    expect(body.values.ocr).toMatchObject({ enabled: true, languages: "ara+eng" })
    // siblings STILL intact after two patches:
    expect(body.values.embedding?.dtype).toBe("int8")

    // The write landed in the real global config file inside the temp config dir.
    expect(existsSync(globalConfigFile)).toBe(true)
    const onDisk = readFileSync(globalConfigFile, "utf8")
    expect(onDisk).toContain("targetedLearning")
    expect(onDisk).toContain('"enabled": true')
    expect(onDisk).toContain('"languages": "ara+eng"')
  }, HTTP_TIMEOUT)

  test("validator rejection returns 400 with the handler error shape", async () => {
    // maxBookSizeMB below the schema x-min (10) fails validateSettingsPayload.
    const { status, body } = await call("/targeted-learning/settings", json({ maxBookSizeMB: 5 }, "PATCH"))
    expect(status).toBe(400)
    expect(body).toEqual({ _tag: "BadRequest" })
  }, HTTP_TIMEOUT)

  test("schema-decode rejection returns 400 with the payload error shape", async () => {
    // ocr.languages must be a string — the HttpApi payload decoder rejects it
    // before the handler, producing the schema-error middleware shape.
    const { status, body } = await call("/targeted-learning/settings", json({ ocr: { languages: 123 } }, "PATCH"))
    expect(status).toBe(400)
    expect(body.name).toBe("BadRequest")
    expect(body.data?.kind).toBe("Payload")
    expect(String(body.data?.message)).toContain("languages")
  }, HTTP_TIMEOUT)
})

describe("POST /targeted-learning/books — upload & import initiation", () => {
  test("upload accepts a book and returns the indexing handle", async () => {
    const bytes = Buffer.from("hello book body for the targeted learning route test")
    const { status, body } = await call("/targeted-learning/books", json({ filename: "hello.txt", contentBase64: bytes.toString("base64") }))
    expect(status).toBe(200)
    expect(body.bookId).toMatch(/^bk_/)
    expect(typeof body.slug).toBe("string")
    expect(body.duplicate).toBe(false)
  }, HTTP_TIMEOUT)

  test("upload with a title derives the slug from the title", async () => {
    const bytes = Buffer.from("another tiny body")
    const { status, body } = await call("/targeted-learning/books", json({ filename: "x.txt", title: "My Test Title", contentBase64: bytes.toString("base64") }))
    expect(status).toBe(200)
    expect(body.slug).toBe("my-test-title")
    await bookTerminal(body.bookId)
  }, HTTP_TIMEOUT)

  test("empty contentBase64 is rejected with 400", async () => {
    const { status, body } = await call("/targeted-learning/books", json({ filename: "empty.txt", contentBase64: "" }))
    expect(status).toBe(400)
    expect(body).toEqual({ _tag: "BadRequest" })
  }, HTTP_TIMEOUT)

  test("unsupported file type is rejected with 400", async () => {
    const { status, body } = await call("/targeted-learning/books", json({ filename: "virus.exe", contentBase64: Buffer.from("MZ").toString("base64") }))
    expect(status).toBe(400)
    expect(body).toEqual({ _tag: "BadRequest" })
  }, HTTP_TIMEOUT)

  test("import from a missing server path is rejected with 400", async () => {
    const { status, body } = await call("/targeted-learning/books/import", json({ path: "/no/such/file.txt" }))
    expect(status).toBe(400)
    expect(body).toEqual({ _tag: "BadRequest" })
  }, HTTP_TIMEOUT)

  test("import from an existing server path accepts the book", async () => {
    const src = path.join(instanceDir, "import-me.txt")
    writeFileSync(src, "imported book body")
    const { status, body } = await call("/targeted-learning/books/import", json({ path: src, title: "Imported" }))
    expect(status).toBe(200)
    expect(body.bookId).toMatch(/^bk_/)
    expect(body.duplicate).toBe(false)
    await bookTerminal(body.bookId)
  }, HTTP_TIMEOUT)
})

describe("books + jobs lifecycle offline (no embedding model)", () => {
  test("uploaded book fails in the background and the job records the error", async () => {
    const bytes = Buffer.from("lifecycle book body")
    const { body: up } = await call("/targeted-learning/books", json({ filename: "life.txt", contentBase64: bytes.toString("base64") }))
    const book = await bookTerminal(up.bookId)
    // Offline the embed model is absent; the deterministic failure is asserted
    // (not the exact message — that text belongs to another agent's lock).
    expect(book.status).toBe("failed")
    expect(typeof book.error).toBe("string")
    expect(book.error!.length).toBeGreaterThan(0)

    const { body: jobsBody } = await call("/targeted-learning/jobs")
    const job = jobsBody.jobs.find((j: { bookId: string }) => j.bookId === up.bookId)
    expect(job).toBeDefined()
    expect(job.status).toBe("failed")
    expect(job.error).toBe(book.error)
    expect(typeof job.progress).toBe("number")
  }, HTTP_TIMEOUT)

  test("pause / resume / cancel on a terminal job return false, retry re-queues it", async () => {
    const { body: up } = await call("/targeted-learning/books", json({ filename: "jobctl.txt", contentBase64: Buffer.from("job control body").toString("base64") }))
    const book = await bookTerminal(up.bookId)
    expect(book.status).toBe("failed")
    const { body: jobsBody } = await call("/targeted-learning/jobs")
    const job = jobsBody.jobs.find((j: { bookId: string }) => j.bookId === up.bookId)
    expect(job).toBeDefined()

    const pause = await call(`/targeted-learning/jobs/${job.id}/pause`, { method: "POST" })
    expect(pause.status).toBe(200)
    expect(pause.body).toBe(false)
    const resume = await call(`/targeted-learning/jobs/${job.id}/resume`, { method: "POST" })
    expect(resume.status).toBe(200)
    expect(resume.body).toBe(false)
    const cancel = await call(`/targeted-learning/jobs/${job.id}/cancel`, { method: "POST" })
    expect(cancel.status).toBe(200)
    expect(cancel.body).toBe(false)

    const retry = await call(`/targeted-learning/jobs/${job.id}/retry`, { method: "POST" })
    expect(retry.status).toBe(200)
    expect(retry.body).toBe(true)
    // The retried job fails again offline; its status transitions queue → failed.
    const after = await jobTerminal(job.id)
    expect(after.status).toBe("failed")
  }, HTTP_TIMEOUT)

  test("job control on an unknown job id returns false (not an error)", async () => {
    const pause = await call("/targeted-learning/jobs/job_does_not_exist/pause", { method: "POST" })
    expect(pause.status).toBe(200)
    expect(pause.body).toBe(false)
  }, HTTP_TIMEOUT)

  test("delete removes the book and a second delete returns false", async () => {
    const { body: up } = await call("/targeted-learning/books", json({ filename: "delete-me.txt", contentBase64: Buffer.from("delete me body").toString("base64") }))
    const book = await bookTerminal(up.bookId)
    expect(book.status).toBe("failed")

    const del = await call(`/targeted-learning/books/${up.bookId}`, { method: "DELETE" })
    expect(del.status).toBe(200)
    expect(del.body).toBe(true)

    const list = await call("/targeted-learning/books")
    expect(list.body.books.find((b: { id: string }) => b.id === up.bookId)).toBeUndefined()

    const delAgain = await call(`/targeted-learning/books/${up.bookId}`, { method: "DELETE" })
    expect(delAgain.status).toBe(200)
    expect(delAgain.body).toBe(false)
  }, HTTP_TIMEOUT)
})

describe("error shapes at the HTTP boundary", () => {
  // The TL group declares NO NotFound errors: missing resources answer 200
  // with `false` (see delete/job tests above), and an unknown sub-route is not
  // a 404 either — it falls through the production catch-all UI route (the SPA
  // shell). Both behaviors are pinned here so a future error-contract change
  // is a conscious decision, not an accident.
  test("unknown TL sub-route falls through to the UI catch-all (no 404 contract)", async () => {
    const { status, body, text } = await call("/targeted-learning/does-not-exist")
    expect(status).toBe(200)
    expect(text.startsWith("<")).toBe(true)
    // Non-JSON body stays raw text in `call()`.
    expect(typeof body).toBe("string")
  }, HTTP_TIMEOUT)

  test("missing credentials → 401", async () => {
    const url = new URL("/targeted-learning/books", "http://localhost")
    url.searchParams.set("directory", instanceDir)
    const res = await web.handler(new Request(url), (HttpApiApp as any).context)
    expect(res.status).toBe(401)
  }, HTTP_TIMEOUT)

  test("retrieval inspector runs without an LLM and reports not-ready on an empty library", async () => {
    const { status, body } = await call("/targeted-learning/search", json({ query: "photosynthesis" }))
    expect(status).toBe(200)
    expect(body.decision).toBe("not-ready")
    expect(body.note).toBe("no indexed books")
  }, HTTP_TIMEOUT)

  test("memory mutations on unknown ids return false (no 404 contract)", async () => {
    const del = await call("/targeted-learning/memory/student/memory_unknown", { method: "DELETE" })
    expect(del.status).toBe(200)
    expect(del.body).toBe(false)
    const pin = await call("/targeted-learning/memory/student/memory_unknown/pin", json({ pinned: true }))
    expect(pin.status).toBe(200)
    expect(pin.body).toBe(false)
    const delNote = await call("/targeted-learning/memory/notes/note_unknown", { method: "DELETE" })
    expect(delNote.status).toBe(200)
    expect(delNote.body).toBe(false)
  }, HTTP_TIMEOUT)
})
