import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { authFetch } from "@/utils/auth-client"

/**
 * Voice-mode client for the prompt input (M1).
 *
 * Mirrors the M0 demo client (packages/voice/web/app.js) but talks to the
 * gateway through the main server's `/voice/*` mount:
 *
 *   enable() → POST /voice/listen (authed; ticket + bridge registration)
 *            → WS /voice/ws?ticket=… (proxied; mic frames in, audio out)
 *
 * Transcript finals come back as `session-student` (session mode disables the
 * gateway's scripted teacher); teacher audio arrives as `tts-audio` PCM frames
 * regardless of whether the reply was spoken by the bridge or the demo script.
 */

export type VoiceStatus = "off" | "connecting" | "idle" | "listening" | "thinking" | "speaking" | "error"

export interface VoiceClientOptions {
  /** Session to attach spoken replies to; `undefined` = new session (listen with empty id). */
  sessionID: () => string | undefined
  sttEngine: () => "local" | "cloud"
  sttLang: () => "auto" | "en" | "ar"
  /** Recognized transcript ready for the prompt input (already auto-corrected). */
  onFinal: (text: string, lang: "en" | "ar") => void
}

interface VoiceStore {
  status: VoiceStatus
  partial: string
  partialLang: "en" | "ar"
  notice: string | null
}

const ENDPOINT_SILENCE_MS = 600
const VOICE_THRESHOLD = 0.02

export function createVoiceClient(options: VoiceClientOptions) {
  const [store, setStore] = createStore<VoiceStore>({
    status: "off",
    partial: "",
    partialLang: "en",
    notice: null,
  })

  let ws: WebSocket | null = null
  let ticket: string | null = null

  // ---------------------------------------------------------------- audio ---
  let ttsSampleRate = 44100
  const playback = { ctx: null as AudioContext | null, queue: [] as AudioBufferSourceNode[], nextTime: 0 }

  function playbackCtx(): AudioContext | null {
    try {
      if (!playback.ctx) playback.ctx = new AudioContext()
      if (playback.ctx.state === "suspended") void playback.ctx.resume().catch(() => {})
      return playback.ctx
    } catch {
      return null
    }
  }

  function playPcmChunk(b64: string) {
    const ctx = playbackCtx()
    if (!ctx) return
    try {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const samples = new Int16Array(bytes.buffer)
      const buffer = ctx.createBuffer(1, samples.length, ttsSampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 32768
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      const now = ctx.currentTime
      if (playback.nextTime < now) playback.nextTime = now + 0.02
      src.start(playback.nextTime)
      playback.nextTime += buffer.duration
      playback.queue.push(src)
      src.onended = () => {
        const idx = playback.queue.indexOf(src)
        if (idx >= 0) playback.queue.splice(idx, 1)
      }
    } catch {
      // A corrupt frame must never break the session.
    }
  }

  function stopAllPlayback() {
    for (const src of [...playback.queue]) {
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
    }
    playback.queue.length = 0
    playback.nextTime = 0
  }

  // ------------------------------------------------------------------ mic ---
  const mic = { stream: null as MediaStream | null, node: null as ScriptProcessorNode | null, ctx: null as AudioContext | null, on: false, silenceMs: 0, sawSpeech: false }

  function downsampleTo16k(input: Float32Array, fromRate: number): Int16Array {
    const ratio = fromRate / 16000
    const n = Math.floor(input.length / ratio)
    const out = new Int16Array(n)
    for (let i = 0; i < n; i++) {
      // block-average downsample (adequate for speech STT)
      const start = Math.floor(i * ratio)
      const end = Math.min(Math.floor((i + 1) * ratio), input.length)
      let sum = 0
      for (let j = start; j < end; j++) sum += input[j]
      const v = sum / Math.max(1, end - start)
      out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
    }
    return out
  }

  async function startMic() {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } })
    mic.ctx = new AudioContext()
    const source = mic.ctx.createMediaStreamSource(mic.stream)
    const processor = mic.ctx.createScriptProcessor(4096, 1, 1)
    mic.node = processor
    source.connect(processor)
    processor.connect(mic.ctx.destination)
    mic.on = true
    mic.silenceMs = 0
    mic.sawSpeech = false
    processor.onaudioprocess = (event) => {
      if (!mic.on) return
      const input = event.inputBuffer.getChannelData(0)
      const pcm16 = downsampleTo16k(input, mic.ctx!.sampleRate)
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(pcm16.buffer)
      // endpointing: 600ms of silence after speech triggers a flush
      let peak = 0
      for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]))
      if (peak > VOICE_THRESHOLD) {
        mic.sawSpeech = true
        mic.silenceMs = 0
      } else if (mic.sawSpeech) {
        mic.silenceMs += (input.length / mic.ctx!.sampleRate) * 1000
        if (mic.silenceMs >= ENDPOINT_SILENCE_MS) {
          mic.sawSpeech = false
          mic.silenceMs = 0
          send({ type: "stt-flush" })
        }
      }
    }
    send({ type: "mic-active", active: true })
  }

  function stopMic() {
    mic.on = false
    send({ type: "mic-active", active: false })
    try {
      mic.node?.disconnect()
      mic.stream?.getTracks().forEach((track) => track.stop())
      void mic.ctx?.close()
    } catch {
      /* already closed */
    }
    mic.stream = mic.node = mic.ctx = null
  }

  // ------------------------------------------------------------------- ws ---
  function send(obj: Record<string, unknown>) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  function handleMessage(m: Record<string, any>) {
    switch (m.type) {
      case "state":
        setStore("status", m.state as VoiceStatus)
        break
      case "tts-ready":
        ttsSampleRate = m.sample_rate ?? 44100
        break
      case "config":
        if (m.notice) setStore("notice", String(m.notice))
        break
      case "stt-partial":
        setStore("partial", String(m.text ?? ""))
        setStore("partialLang", m.lang === "ar" ? "ar" : "en")
        break
      case "stt-final":
        setStore("partial", "")
        break
      case "session-student":
        options.onFinal(String(m.text ?? ""), m.lang === "ar" ? "ar" : "en")
        break
      case "tts-audio":
        playPcmChunk(String(m.b64 ?? ""))
        break
      case "tts-interrupted":
        stopAllPlayback()
        break
      case "tts-cancelled":
        break
      default:
        break
    }
  }

  function connect() {
    if (!ticket) return
    const protocol = location.protocol === "https:" ? "wss" : "ws"
    ws = new WebSocket(`${protocol}://${location.host}/voice/ws?ticket=${encodeURIComponent(ticket)}`)
    ws.binaryType = "arraybuffer"
    ws.onopen = () => {
      send({
        type: "voice-config",
        sttEngine: options.sttEngine(),
        sttLang: options.sttLang(),
        autoCorrect: true,
      })
      send({
        type: "session-listen",
        sessionId: options.sessionID() ?? "",
        lang: options.sttLang() === "ar" ? "ar" : "en",
      })
      setStore("status", "idle")
      setStore("notice", null)
      void startMic().catch((error: unknown) => {
        setStore("status", "error")
        setStore("notice", String((error as Error)?.message ?? error))
      })
    }
    ws.onclose = () => {
      ws = null
      if (store.status !== "off" && store.status !== "error") {
        setStore("status", "error")
        setStore("notice", "connection lost")
      }
    }
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return
      try {
        handleMessage(JSON.parse(event.data))
      } catch {
        /* ignore malformed frames */
      }
    }
  }

  // ----------------------------------------------------------------- flow ---
  async function enable() {
    if (store.status !== "off") return
    setStore("status", "connecting")
    setStore("notice", null)
    setStore("partial", "")
    try {
      const response = await authFetch("/voice/listen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionID: options.sessionID() ?? "",
          lang: options.sttLang() === "ar" ? "ar" : "en",
          on: true,
        }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => null)
        setStore("status", "error")
        setStore(
          "notice",
          (detail as { error?: string } | null)?.error ?? `voice unavailable (HTTP ${response.status})`,
        )
        return
      }
      const data = (await response.json()) as { ticket?: string | null }
      if (!data.ticket) {
        setStore("status", "error")
        setStore("notice", "voice gateway did not issue a connection ticket")
        return
      }
      ticket = data.ticket
      connect()
    } catch (error) {
      setStore("status", "error")
      setStore("notice", String((error as Error)?.message ?? error))
    }
  }

  async function disable() {
    if (store.status === "off") return
    stopMic()
    stopAllPlayback()
    ws?.close()
    ws = null
    ticket = null
    setStore("status", "off")
    setStore("partial", "")
    setStore("notice", null)
    void authFetch("/voice/listen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID: options.sessionID() ?? "", on: false }),
    }).catch(() => {})
  }

  /** Toggle from the mic pill. Tapping while the teacher speaks = barge-in. */
  function toggle() {
    if (store.status === "speaking") {
      stopAllPlayback()
      send({ type: "barge-in" })
      return
    }
    if (store.status === "off") void enable()
    else void disable()
  }

  /**
   * Test/injection path: feed a transcript as if it had been recognized
   * (same route a real STT final takes). Used by QA and by demos without a mic.
   */
  function injectTranscript(text: string, lang: "en" | "ar") {
    send({ type: "stt-inject", text, lang })
  }

  // The first prompt on a new-session page creates the session: re-attach the
  // bridge (and the gateway's session mode) to the real session id.
  createEffect(
    on(
      () => options.sessionID(),
      (sessionID, previous) => {
        if (store.status === "off" || store.status === "error") return
        if (!sessionID || sessionID === previous) return
        const lang = options.sttLang() === "ar" ? "ar" : "en"
        void authFetch("/voice/listen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionID, lang, on: true }),
        }).catch(() => {})
        send({ type: "session-listen", sessionId: sessionID, lang })
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    void disable()
  })

  return {
    store,
    toggle,
    injectTranscript,
    /** Raw WS access is intentionally narrow: everything goes through send(). */
  }
}

export type VoiceClient = ReturnType<typeof createVoiceClient>
