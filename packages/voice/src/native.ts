/**
 * Native backend adapter: one `divee-voice` sidecar process (Rust, NDJSON over
 * stdio) exposes local STT (vosk), cloud STT (OpenAI-compatible / mock) and TTS
 * (supertonic-3) behind the same three JsonLineWorker interfaces the python
 * workers provide. The gateway code does not change shape — only the transport.
 *
 * Translation map (python worker message ↔ sidecar op/event):
 *   stt  {config,audio,flush,reset}      ↔ stt.config / stt.audio(engine=local) / stt.flush / stt.reset
 *   cloud {config,audio,flush,reset}     ↔ stt.cloud.config / stt.audio(engine=cloud) / stt.flush
 *   tts  {config,synth,cancel}           ↔ tts.config / tts.synth(sid) / tts.cancel(sid)
 *   {partial,final,loaded,error}         ↔ stt.partial / stt.final / stt.loaded / stt.error
 *   {ready,tts-meta,tts-audio,tts-done}  ↔ tts.ready / tts.meta / tts.audio / tts.done
 *
 * The API key VALUE never crosses the protocol: the sidecar reads it from the
 * env var NAME given in stt.cloud.config at call time.
 */
import type { Subprocess } from "bun";
import { dirname } from "node:path";

export interface JsonLineWorker {
  send: (obj: Record<string, unknown>) => void;
  proc: Subprocess<"pipe", "pipe", "inherit">;
}

type Msg = Record<string, any>;
type Handler = (m: Msg) => void;

export interface NativeOpts {
  binary: string;
  modelsDir: string;
  supertonicOnnx: string;
  supertonicStyles: string;
  cloudCfg: { provider: string; baseUrl: string; model: string; apiKeyEnv: string };
  voice: string;
  log: (...parts: unknown[]) => void;
  onStt: Handler;
  onCloud: Handler;
  onTts: Handler;
}

export function spawnNativeBackend(opts: NativeOpts): {
  stt: JsonLineWorker;
  cloud: JsonLineWorker;
  tts: JsonLineWorker;
} {
  const proc = Bun.spawn(
    [
      opts.binary,
      "--serve",
      "--models-dir", opts.modelsDir,
      "--supertonic-onnx", opts.supertonicOnnx,
      "--supertonic-styles", opts.supertonicStyles,
    ],
    {
      stdin: "pipe", stdout: "pipe", stderr: "inherit",
      env: {
        ...process.env,
        // Vendored libvosk.so fallback (build.rs bakes an $ORIGIN rpath too)
        LD_LIBRARY_PATH: `${dirname(opts.binary)}/../../lib${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ""}`,
      },
    },
  );

  // Response correlation: sidecar replies {id, ok, result|error}; the python
  // workers only push type:* events, so responses are translated (or dropped).
  type Pending = { kind: "stt" | "cloud" | "tts"; onResult?: (result: Msg) => void };
  const pending = new Map<number, Pending>();
  let nextReqId = 1;

  function request(kind: "stt" | "cloud" | "tts", obj: Msg, onResult?: (result: Msg) => void) {
    const id = nextReqId++;
    pending.set(id, { kind, onResult });
    proc.stdin.write(JSON.stringify({ id, ...obj }) + "\n");
  }

  function emitTo(kind: "stt" | "cloud" | "tts", m: Msg) {
    if (kind === "stt") opts.onStt(m);
    else if (kind === "cloud") opts.onCloud(m);
    else opts.onTts(m);
  }

  // ------------------------------------------------- sidecar → worker msgs ---
  (async () => {
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let m: Msg;
        try {
          m = JSON.parse(line);
        } catch {
          opts.log("native: bad json:", line.slice(0, 120));
          continue;
        }
        if (m.event === undefined) {
          // {id, ok, result|error} response
          const p = pending.get(m.id);
          if (!p) continue;
          pending.delete(m.id);
          if (m.ok) p.onResult?.(m.result ?? {});
          else emitTo(p.kind, { type: "error", message: String(m.error ?? "native request failed") });
          continue;
        }
        switch (m.event) {
          case "stt.partial":
            emitTo("stt", { type: "partial", lang: m.lang, text: m.text });
            break;
          case "stt.final":
            if (m.engine === "cloud") {
              emitTo("cloud", { type: "final", lang: m.lang, text: m.text, confidence: m.confidence });
            } else {
              emitTo("stt", { type: "final", lang: m.lang, text: m.text, confidence: m.confidence });
            }
            break;
          case "stt.loaded":
            emitTo("stt", { type: "loaded", lang: m.lang, load_s: Math.round((m.load_ms ?? 0) / 100) / 10 });
            break;
          case "stt.error":
            if (m.kind === "cloud-fallback") {
              emitTo("cloud", { type: "error", kind: "cloud-fallback", message: m.message });
            } else {
              emitTo("stt", { type: "error", message: m.message });
            }
            break;
          case "tts.ready":
            emitTo("tts", { type: "ready", sample_rate: m.sample_rate, voice: m.voice });
            break;
          case "tts.meta":
            emitTo("tts", {
              type: "tts-meta", id: m.sid, sample_rate: m.sample_rate,
              audio_s: m.audio_s, wall_ms: m.wall_ms,
            });
            break;
          case "tts.audio":
            emitTo("tts", { type: "tts-audio", id: m.sid, seq: m.seq, b64: m.b64 });
            break;
          case "tts.done":
            emitTo("tts", { type: "tts-done", id: m.sid, rtf: m.rtf, audio_s: m.audio_s, wall_ms: m.wall_ms });
            break;
          case "tts.cancelled":
            emitTo("tts", { type: "tts-cancelled", id: m.sid });
            break;
          case "tts.error":
            emitTo("tts", { type: "error", message: m.message });
            break;
          default:
            opts.log("native: unhandled event", m.event);
        }
      }
    }
    opts.log("native sidecar exited");
  })();

  // ------------------------------------------------- worker msgs → sidecar ---
  function sendStt(obj: Msg) {
    switch (obj.type) {
      case "config": return request("stt", { op: "stt.config", models: obj.models });
      case "audio":  return request("stt", { op: "stt.audio", b64: obj.b64, lang: obj.lang, engine: "local" });
      case "flush":  return request("stt", { op: "stt.flush", engine: "local" });
      case "reset":  return request("stt", { op: "stt.reset" });
      default: opts.log("native stt: unknown message", String(obj.type));
    }
  }

  function sendCloud(obj: Msg) {
    switch (obj.type) {
      case "config":
        // The python worker answered config with a ready event; the sidecar
        // answers stt.cloud.config with a response — synthesize ready here.
        return request("cloud", {
          op: "stt.cloud.config",
          provider: obj.provider,
          baseUrl: obj.baseUrl,
          model: obj.model,
          apiKeyEnv: obj.apiKeyEnv,
        }, (result) => {
          emitTo("cloud", {
            type: "ready",
            engine: "cloud",
            provider: result.provider,
            model: result.model,
            hasKey: Boolean(result.hasKey),
          });
        });
      case "audio": return request("cloud", { op: "stt.audio", b64: obj.b64, lang: obj.lang, engine: "cloud" });
      case "flush": return request("cloud", { op: "stt.flush", engine: "cloud" });
      case "reset": return request("cloud", { op: "stt.reset" });
      default: opts.log("native cloud: unknown message", String(obj.type));
    }
  }

  function sendTts(obj: Msg) {
    switch (obj.type) {
      case "config": return request("tts", { op: "tts.config", voice: obj.voice });
      case "synth":
        return request("tts", {
          op: "tts.synth", sid: obj.id, text: obj.text,
          lang: obj.lang, steps: obj.steps, speed: obj.speed,
        });
      case "cancel": return request("tts", { op: "tts.cancel", sid: obj.id });
      default: opts.log("native tts: unknown message", String(obj.type));
    }
  }

  const typed = (send: (obj: Msg) => void): JsonLineWorker => ({
    send: (obj) => send(obj),
    proc: proc as Subprocess<"pipe", "pipe", "inherit">,
  });

  return {
    stt: typed(sendStt),
    cloud: typed(sendCloud),
    tts: typed(sendTts),
  };
}
