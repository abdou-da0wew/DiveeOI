import { StreamingChunker } from "@diveeoi/voice/chunker"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Voice bridge: connects the main server's session event stream to the voice
 * gateway (packages/voice, `bun src/server.ts`).
 *
 * Plain module (not an Effect service): its whole state is process-global by
 * nature — one GlobalBus subscription, one child gateway, one ticket store —
 * and the `/voice/*` route handlers are its only callers (repo rule: plain
 * async glue passes explicit context; no ambient instance shims).
 *
 * - The prompt-input voice pill registers a session via `listen`; the route
 *   handler also gets a one-time WS ticket for `/voice/ws` (mirrors the pty
 *   ticket pattern).
 * - While a session is registered, assistant TEXT parts streamed through the
 *   GlobalBus (`message.part.updated` / `message.part.delta`) are split into
 *   speakable sentences with the shared StreamingChunker and forwarded to the
 *   gateway's `POST /voice/say`, which synthesizes and broadcasts the audio.
 * - Reasoning/tool parts are never spoken: part types are tracked from
 *   `message.part.updated` and only `type: "text"` deltas feed the chunker.
 *
 * The gateway is lazy: the first `listen` starts it as a child process
 * (`bun packages/voice/src/server.ts`) unless `VOICE_GATEWAY_URL` points at an
 * already-running one.
 */

export class VoiceGatewayUnavailableError extends Error {
  readonly name = "VoiceGatewayUnavailable"
}

const gatewayURL = (): URL => new URL(process.env.VOICE_GATEWAY_URL ?? "http://127.0.0.1:4747")
// Shared secret for gateway→say calls. When we spawn the gateway ourselves we
// mint one per server boot and hand it to the child; for an externally managed
// gateway the operator sets VOICE_BRIDGE_TOKEN on both sides.
const bridgeToken = process.env.VOICE_BRIDGE_TOKEN || randomUUID()
const voiceServerTs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../voice/src/server.ts")

const listeningSessions = new Map<string, "en" | "ar">()
const partTypes = new Map<string, string>()
const partSessions = new Map<string, string>()
const chunkers = new Map<string, StreamingChunker>()
const tickets = new Map<string, number>()

let child: Bun.Subprocess<"ignore", "ignore", "inherit"> | null = null
let ensurePromise: Promise<boolean> | null = null
let busListener: ((event: unknown) => void) | null = null

function log(...parts: unknown[]) {
  console.log("[voice]", ...parts)
}

async function gatewayHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(new URL("/healthz", gatewayURL()), { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

function ensureGateway(): Promise<boolean> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      if (await gatewayHealthy()) return true
      if (process.env.VOICE_GATEWAY_URL) return false // external gateway is down; nothing to spawn
      if (child) return false
      if (!existsSync(voiceServerTs)) {
        log("gateway source not found at", voiceServerTs)
        return false
      }
      if (!process.execPath.includes("bun")) {
        log("voice gateway needs bun; refusing to spawn under", process.execPath)
        return false
      }
      log("spawning voice gateway:", voiceServerTs)
      child = Bun.spawn([process.execPath, voiceServerTs], {
        env: { ...process.env, VOICE_BRIDGE_TOKEN: bridgeToken },
        stdout: "ignore",
        stderr: "inherit",
      })
      for (let waited = 0; waited < 10_000; waited += 250) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (await gatewayHealthy(800)) {
          log(`voice gateway up at ${gatewayURL().origin}`)
          return true
        }
      }
      log("voice gateway did not become healthy in 10s")
      return false
    })()
    ensurePromise.finally(() => {
      ensurePromise = null
    })
  }
  return ensurePromise
}

// TTS language is detected per sentence: a session can answer in either
// language regardless of the recognizer language the pill registered.
const detectLang = (text: string): "en" | "ar" => (/[\u0600-\u06FF]/.test(text) ? "ar" : "en")

function say(text: string, sessionId: string) {
  const lang = detectLang(text)
  void (async () => {
    try {
      const response = await fetch(new URL("/voice/say", gatewayURL()), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Always sent: our spawned gateway checks it (we passed it the token
          // at spawn), an open external gateway just ignores it.
          "x-voice-bridge": bridgeToken,
        },
        body: JSON.stringify({ text, lang, sessionId }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) log(`say rejected (${response.status}): ${text.slice(0, 48)}`)
    } catch {
      log(`say failed for session ${sessionId} (gateway down?): ${text.slice(0, 48)}`)
    }
  })()
}

function flushPart(partID: string) {
  const chunker = chunkers.get(partID)
  if (!chunker) return
  const sessionID = partSessions.get(partID)
  const isListening = sessionID ? listeningSessions.has(sessionID) : false
  chunkers.delete(partID)
  partSessions.delete(partID)
  if (!sessionID || !isListening) return
  for (const chunk of chunker.flush()) say(chunk, sessionID)
}

export function dropSession(sessionID: string) {
  listeningSessions.delete(sessionID)
  for (const [partID, owner] of partSessions) {
    if (owner === sessionID) {
      chunkers.delete(partID)
      partSessions.delete(partID)
    }
  }
}

function onBusEvent(event: unknown) {
  const { payload } = (event ?? {}) as { payload?: { type?: string; properties?: Record<string, any> } }
  if (!payload?.type) return
  const properties = payload.properties ?? {}
  if (payload.type === "message.part.updated") {
    const part = properties.part as { id?: string; type?: string; time?: { end?: number } } | undefined
    if (!part?.id) return
    partTypes.set(part.id, String(part.type))
    if (part.type === "text" && part.time?.end) flushPart(part.id)
    return
  }
  if (payload.type === "message.part.delta") {
    const partID = properties.partID as string | undefined
    if (!partID || properties.field !== "text") return
    if (partTypes.get(partID) !== "text") return // reasoning/tool deltas stay silent
    const sessionID = String(properties.sessionID ?? "")
    if (!listeningSessions.has(sessionID)) return
    let chunker = chunkers.get(partID)
    if (!chunker) {
      chunker = new StreamingChunker({ maxChars: 220 })
      chunkers.set(partID, chunker)
      partSessions.set(partID, sessionID)
    }
    for (const chunk of chunker.push(String(properties.delta ?? ""))) say(chunk, sessionID)
    return
  }
  if (payload.type === "message.part.removed") {
    const partID = properties.partID as string | undefined
    if (partID) {
      chunkers.delete(partID)
      partSessions.delete(partID)
      partTypes.delete(partID)
    }
    return
  }
  if (payload.type === "session.idle" || payload.type === "session.status") {
    const sessionID = String(properties.sessionID ?? "")
    const status = properties.status as { type?: string } | undefined
    if (!sessionID) return
    // Safety flush: an aborted/interrupted stream may leave an unterminated
    // text part; when the session goes idle, speak whatever is still held.
    if (payload.type === "session.idle" || status?.type === "idle") {
      for (const [partID, owner] of [...partSessions]) {
        if (owner === sessionID) flushPart(partID)
      }
    }
  }
}

/** Idempotently subscribes the bridge to the process-global event bus. */
function ensureBusListener() {
  if (busListener) return
  busListener = onBusEvent
  GlobalBusRef.on("event", busListener)
}

// Indirection keeps this module importable outside the server package too
// (the bus lives in packages/server; resolve it lazily).
import { GlobalBus as GlobalBusRef } from "@/bus/global"

function issueTicket(): string {
  const now = Date.now()
  for (const [ticket, expiry] of tickets) {
    if (expiry < now) tickets.delete(ticket)
  }
  const ticket = randomUUID()
  tickets.set(ticket, now + 30_000)
  return ticket
}

export interface ListenResult {
  ticket: string | null
}

/** Registers/unregisters a session for spoken teacher replies. */
export async function listen(input: {
  sessionID: string
  lang: "en" | "ar"
  on: boolean
}): Promise<ListenResult> {
  if (!input.on) {
    dropSession(input.sessionID)
    return { ticket: null }
  }
  ensureBusListener()
  const healthy = await ensureGateway()
  if (!healthy) {
    throw new VoiceGatewayUnavailableError(
      "voice gateway is not running and could not be started (needs bun + packages/voice)",
    )
  }
  listeningSessions.set(input.sessionID, input.lang)
  return { ticket: issueTicket() }
}

/** Single-use ticket check for the `/voice/ws` upgrade handshake. */
export function consumeTicket(ticket: string): boolean {
  const expiry = tickets.get(ticket)
  if (!expiry || expiry < Date.now()) return false
  tickets.delete(ticket)
  return true
}

/** Diagnostics. */
export function status(): { gateway: string; listening: string[] } {
  return { gateway: gatewayURL().origin, listening: [...listeningSessions.keys()] }
}
