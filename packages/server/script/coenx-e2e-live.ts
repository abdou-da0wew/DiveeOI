/**
 * Live end-to-end validation: boots the real DiveeOI server with the bundled
 * OpenCode Zen free models as the default model, creates a session in a fresh
 * project directory, sends a real authoring prompt, and verifies the agent
 * actually calls the canonical coenx_video_* tools (validate -> preview ->
 * export) with a real LLM on the other end.
 *
 * No credentials required: OpenCode Zen's anonymous free tier is used with
 * apiKey "public" (the provider plugin forces it when no key is configured).
 *
 * Run: bun packages/server/script/coenx-e2e-live.ts
 * Evidence: /tmp/coenx-e2e-live/transcript.json
 */
import { mkdirSync, existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SERVER_PORT = 4199
const BASE = `http://127.0.0.1:${SERVER_PORT}`
// script: packages/server/script/coenx-e2e-live.ts -> repo root is three up
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SERVER_DIR = path.join(ROOT, "packages/server")
if (!existsSync(SERVER_DIR)) {
  console.error(`[e2e] resolved server directory does not exist: ${SERVER_DIR}`)
  process.exit(2)
}

const tmp = await mkdtemp(`${os.tmpdir()}/coenx-e2e-live-`)
const projectRoot = path.join(tmp, "project")
await mkdir(projectRoot, { recursive: true })
const dbFile = path.join(tmp, "opencode.db")
const evidencePath = path.join(tmp, "transcript.json")

const config = {
  $schema: "https://opencode.ai/config.schema.json",
  // Pin the default model to the bundled OpenCode Zen free tier (user ask:
  // "make it default with opencode models").
  model: "opencode/grok-code",
}

const env = {
  ...process.env,
  PORT: String(SERVER_PORT),
  HOST: "127.0.0.1",
  DIVEEOI_DB: dbFile,
  DIVEEOI_CONFIG_CONTENT: JSON.stringify(config),
  // Explicit local Basic-auth credentials (the non-production default): the
  // script authenticates with the same pair below.
  DIVEEOI_SERVER_USERNAME: "DIVEEOI",
  DIVEEOI_SERVER_PASSWORD: "divee",
  // The provider catalogue is fetched live from models.dev (grok-code is a
  // zero-cost tool-calling model on OpenCode Zen's anonymous free tier; the
  // bundled opencode plugin forces apiKey "public" when no key is set).
  COENX_VIDEO_NATIVE: path.join(ROOT, "packages/coenx-video/native/coenx-video-native/target/release/coenx-video-native"),
}

console.log("[e2e] booting server on", BASE, "db:", dbFile)
const server = Bun.spawn({
  cmd: [process.execPath, "--conditions=browser", "./src/main.ts"],
  cwd: SERVER_DIR,
  env,
  stdout: "pipe",
  stderr: "pipe",
})
const serverLog: string[] = []
const pump = (stream: ReadableStream<Uint8Array> | undefined) => {
  if (!stream) return
  void (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      const text = decoder.decode(chunk)
      serverLog.push(text)
      if (serverLog.length < 40) console.log("[server]", text.trim().slice(0, 200))
    }
  })()
}
pump(server.stdout)
pump(server.stderr)

const fail = async (message: string) => {
  console.error("[e2e] FAIL:", message)
  await writeFile(path.join(tmp, "server.log"), serverLog.join(""), "utf8")
  console.error("[e2e] server log at", path.join(tmp, "server.log"))
  server.kill()
  process.exit(1)
}

async function waitForServer(timeoutMs = 210_000) {
  const auth = `Basic ${btoa("DIVEEOI:divee")}`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`, { headers: { authorization: auth } })
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await fail("server did not become healthy in time")
}

type Json = Record<string, unknown>
const AUTH = `Basic ${btoa("DIVEEOI:divee")}`
const api = async (input: string, init?: RequestInit) => {
  const response = await fetch(`${BASE}${input}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: AUTH, ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${input} -> ${response.status}: ${await response.text()}`)
  return (await response.json()) as Json
}

await waitForServer()
console.log("[e2e] server healthy")

const created = (await api("/api/session", {
  method: "POST",
  body: JSON.stringify({ location: { directory: projectRoot } }),
})) as { data: { id: string } }
const sessionID = created.data.id
console.log("[e2e] session:", sessionID)

const promptText = `Use the Coenx Video tools to create a short educational clip and prove the pipeline end to end:
1. Author a tiny CML project (one scene, 12 frames, 320x180, fps 6) with a rect panel, the text "Coenx E2E", and a linear-gradient accent.
2. Call coenx_video_validate on it and fix every diagnostic until it is valid.
3. Call coenx_video_inspect on the final source.
4. Call coenx_video_preview for frames 0 and 6.
5. Call coenx_video_export to out/e2e.mp4 with profile low (renderer auto, do not overwrite existing files).
Work strictly through the tools; report the export manifest at the end.`

await api(`/api/session/${sessionID}/prompt`, {
  method: "POST",
  body: JSON.stringify({ prompt: { text: promptText } }),
})
console.log("[e2e] prompt admitted; waiting for the agent to finish")

// The /wait endpoint is a stub in the current V2 session layer (always 503),
// so poll the durable transcript instead: done when at least one assistant
// message exists, every tool call settled, and the transcript is stable.
const waitDeadline = Date.now() + 5.5 * 60_000
let waited = false
let stablePolls = 0
let lastFingerprint = ""
const summarize = (data: Json[] | undefined) =>
  JSON.stringify(
    (data ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      parts: (Array.isArray(message.parts) ? message.parts : []).map((part) => {
        const p = part as Json
        const state = p.state as Json | undefined
        return { type: p.type, tool: p.tool, status: state?.status, textLength: typeof p.text === "string" ? p.text.length : 0 }
      }),
    })),
  )
while (Date.now() < waitDeadline) {
  try {
    const messages = (await api(`/api/session/${sessionID}/message`)) as { data?: Json[] }
    const fingerprint = summarize(messages.data)
    const data = messages.data ?? []
    const toolParts = data
      .flatMap((message) => (Array.isArray(message.parts) ? message.parts : []))
      .filter((part) => (part as Json).type === "tool") as Json[]
    const pendingTool = toolParts.some((part) => {
      const status = String(((part.state as Json | undefined)?.status as string) ?? "")
      return status === "pending" || status === "running"
    })
    const hasAssistant = data.some((message) => message.role === "assistant")
    if (hasAssistant && !pendingTool && fingerprint === lastFingerprint) {
      stablePolls++
      if (stablePolls >= 3) {
        waited = true
        break
      }
    } else {
      stablePolls = 0
    }
    lastFingerprint = fingerprint
    console.log("[e2e] poll: messages", data.length, "tools", toolParts.length, "stable", stablePolls)
  } catch (error) {
    console.log("[e2e] poll error (retrying):", String(error).slice(0, 120))
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000))
}
if (!waited) await fail("agent loop did not finish in time")

const messages = (await api(`/api/session/${sessionID}/message`)) as { data?: Array<Json> }
const parts = (messages.data ?? []).flatMap((message) => (Array.isArray(message.parts) ? message.parts : []))
const toolParts = parts.filter((part) => (part as Json).type === "tool" || (typeof (part as Json).tool === "string"))
const toolNames = toolParts.map((part) => String((part as Json).tool ?? (part as Json).name))

console.log("[e2e] tool calls observed:", JSON.stringify([...new Set(toolNames)]))

const required = ["coenx_video_validate", "coenx_video_inspect", "coenx_video_preview", "coenx_video_export"]
const missing = required.filter((name) => !toolNames.includes(name))
if (missing.length) {
  await fail(`agent did not call: ${missing.join(", ")}. Transcript saved for inspection.`)
}

const exportPart = toolParts.find((part) => (part as Json).tool === "coenx_video_export")
await writeFile(evidencePath, JSON.stringify({ sessionID, messages: messages.data, promptText }, null, 2), "utf8")
console.log("[e2e] export tool state:", JSON.stringify(exportPart).slice(0, 400))
console.log("[e2e] transcript saved:", evidencePath)

const mp4Path = path.join(projectRoot, "out", "e2e.mp4")
try {
  const stat = await import("node:fs/promises").then((fs) => fs.stat(mp4Path))
  console.log("[e2e] exported MP4 exists:", mp4Path, stat.size, "bytes")
  if (stat.size < 1000) await fail("exported MP4 is suspiciously small")
} catch {
  await fail("agent claimed success but out/e2e.mp4 does not exist")
}

console.log("[e2e] PASS: real LLM drove validate -> inspect -> preview -> export with opencode models")
server.kill()
process.exit(0)
