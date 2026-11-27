import { expect, test } from "bun:test"
import { GlobalBus } from "@/bus/global"

/**
 * Bridge stream logic, exercised against a fake gateway over real HTTP:
 * - listening sessions receive completed sentences on POST /voice/say
 * - reasoning deltas and non-listening sessions never reach the gateway
 * - a part end (time.end) flushes the chunker remainder
 * - WS tickets are single-use
 */

interface SayCall {
  text: string
  lang: string
  sessionId?: string
}

const sayCalls: SayCall[] = []

function startFakeGateway(): number {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/healthz") return new Response("ok")
      if (url.pathname === "/voice/say" && req.method === "POST") {
        return req
          .json()
          .then((body) => {
            sayCalls.push(body as SayCall)
            return Response.json({ ok: true })
          })
          .catch(() => new Response("bad json", { status: 400 }))
      }
      return new Response("not found", { status: 404 })
    },
  })
  return server.port
}

function emit(type: string, properties: Record<string, unknown>) {
  GlobalBus.emit("event", { payload: { type, properties } })
}

test("voice bridge speaks text deltas of listening sessions only", async () => {
  const port = startFakeGateway()
  process.env.VOICE_GATEWAY_URL = `http://127.0.0.1:${port}`
  // Imported after the env override so the gateway base resolves to the fake.
  const VoiceBridge = await import("@/voice/bridge")

  const { ticket } = await VoiceBridge.listen({ sessionID: "sess-voice-1", lang: "en", on: true })
  expect(typeof ticket).toBe("string")
  expect(VoiceBridge.consumeTicket(ticket ?? "")).toBe(true)
  expect(VoiceBridge.consumeTicket(ticket ?? "")).toBe(false)

  // Reasoning and foreign-session deltas must stay silent.
  emit("message.part.updated", { part: { id: "r1", type: "reasoning", time: { start: 1 } } })
  emit("message.part.delta", { sessionID: "sess-voice-1", partID: "r1", field: "text", delta: "hidden thoughts. " })
  emit("message.part.delta", { sessionID: "sess-other", partID: "t9", field: "text", delta: "not listening. " })

  // Text part of the listening session streams into sentence chunks.
  emit("message.part.updated", { part: { id: "t1", type: "text", time: { start: 2 } } })
  emit("message.part.delta", { sessionID: "sess-voice-1", partID: "t1", field: "text", delta: "Hello student. How are " })
  emit("message.part.delta", { sessionID: "sess-voice-1", partID: "t1", field: "text", delta: "you today? Fine." })
  emit("message.part.updated", { part: { id: "t1", type: "text", time: { start: 2, end: 3 } } })

  expect(VoiceBridge.status().listening).toEqual(["sess-voice-1"])

  // Two sentences dispatch during streaming, "Fine." on the part-end flush.
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && sayCalls.length < 3) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(sayCalls.length).toBe(3)
  expect(sayCalls[0].text).toBe("Hello student.")
  expect(sayCalls[0].sessionId).toBe("sess-voice-1")
  expect(sayCalls[0].lang).toBe("en")
  expect(sayCalls[1].text).toBe("How are you today?")
  expect(sayCalls[2].text).toBe("Fine.")

  await VoiceBridge.listen({ sessionID: "sess-voice-1", lang: "en", on: false })
  expect(VoiceBridge.status().listening).toEqual([])
})
