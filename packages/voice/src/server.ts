/**
 * DiveeOI voice gateway (M0 demo): static UI + WebSocket hub + voice workers.
 *
 * Browser ⇄ WS ⇄ {
 *   python backend (VOICE_BACKEND=python):
 *     stt_worker.py         engine "local"  (vosk, streaming partials)
 *     stt_cloud_worker.py   engine "cloud"  (OpenAI-compatible / mock, finals)
 *     tts_worker.py         supertonic-3 chunked streaming
 *   native backend (VOICE_BACKEND=native | auto-detect):
 *     divee-voice           one Rust sidecar serving local+cloud STT and TTS
 *                           over the same three interfaces (see src/native.ts)
 * }
 *
 * The STT engine is a runtime setting (sttEngine: "local" | "cloud"). Cloud
 * errors fall back to the local engine for the session automatically.
 * Teacher streaming is scripted here for the demo; M1 hooks the real session
 * stream from packages/server/src/session/processor.ts into the same
 * dispatchChunk path.
 *
 * Run: bun src/server.ts
 * Env: VOICE_PORT, VOICE_BACKEND (native|python|auto, default auto),
 *      VOICE_PYTHON, VOICE_STT_MODELS,
 *      VOICE_CLOUD_STT_PROVIDER, VOICE_CLOUD_STT_BASE_URL, VOICE_CLOUD_STT_MODEL,
 *      VOICE_CLOUD_STT_API_KEY_ENV (key value itself never handled here)
 */
import { spawnNativeBackend } from "./native";
import { StreamingChunker } from "./chunker";
import { correctTranscript } from "./autocorrect";
import { speakableForm } from "./glossary";
import { TEACHER_TEXTS } from "./teacher-texts";

const PORT = Number(process.env.VOICE_PORT ?? 4747);
const PKG = import.meta.dir.replace(/\/src$/, "");
const PYTHON = process.env.VOICE_PYTHON ?? `${PKG}/.venv/bin/python`;
const MODELS_DIR = `${PKG}/models`;
const CACHE_DIR = `${PKG}/assets/cache`;

// Backend selection: the Rust sidecar (packages/learning/native/voice) is the
// production path; the python workers remain as a fallback for environments
// without a built binary. "auto" prefers native when the binary exists.
const BACKEND = (process.env.VOICE_BACKEND ?? "auto") as "native" | "python" | "auto";
const NATIVE_DIR = `${PKG}/../learning/native/voice`;
const NATIVE_BIN = `${NATIVE_DIR}/target/release/divee-voice`;
const NATIVE_MODELS = `${NATIVE_DIR}/models`;
const useNative = BACKEND === "native" || (BACKEND === "auto" && exists(NATIVE_BIN));

const cloudCfg = {
  provider: process.env.VOICE_CLOUD_STT_PROVIDER ?? "groq",
  baseUrl:
    process.env.VOICE_CLOUD_STT_BASE_URL ??
    "https://api.groq.com/openai/v1/audio/transcriptions",
  model: process.env.VOICE_CLOUD_STT_MODEL ?? "whisper-large-v3",
  apiKeyEnv: process.env.VOICE_CLOUD_STT_API_KEY_ENV ?? "VOICE_CLOUD_STT_API_KEY",
};

// ---------------------------------------------------------------- teacher ---
function pickReply(text: string, lang: "en" | "ar"): string {
  const t = text.toLowerCase();
  if (/photosynth|بناء ضوئي|ضوئي/.test(text) || /photosynth/.test(t)) {
    return TEACHER_TEXTS[lang].photosynthesis;
  }
  if (/\b(hello|hi|hey)\b/.test(t) || /مرحبا|السلام|أهلا/.test(text)) {
    return TEACHER_TEXTS[lang].greeting;
  }
  return TEACHER_TEXTS[lang].fallback;
}

// ----------------------------------------------------------------- workers ---
interface JsonLineWorker {
  send: (obj: Record<string, unknown>) => void;
  proc: Bun.Subprocess<"pipe", "pipe", "inherit">;
}

function spawnJsonLineWorker(
  script: string,
  onMessage: (m: Record<string, any>) => void,
): JsonLineWorker {
  const proc = Bun.spawn([PYTHON, script], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  let buf = "";
  (async () => {
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          onMessage(JSON.parse(line));
        } catch {
          onMessage({ type: "error", message: `bad worker json: ${line.slice(0, 120)}` });
        }
      }
    }
    log("worker exited", script);
  })();
  return {
    proc,
    send(obj) {
      proc.stdin.write(JSON.stringify(obj) + "\n");
    },
  };
}

// ------------------------------------------------------------------ state ---
const sockets = new Set<ServerWebSocket<unknown>>();
const config = {
  sttEngine: "local" as "local" | "cloud",
  sttLang: "en" as "en" | "ar" | "auto",
  voice: "M1",
  steps: 5,
  speed: 1.05,
  autoCorrect: true,
};
let stt: JsonLineWorker | null = null;
let cloud: JsonLineWorker | null = null;
let cloudInfo: { provider: string | null; model: string | null; hasKey: boolean } = {
  provider: null,
  model: null,
  hasKey: Boolean(process.env[cloudCfg.apiKeyEnv]),
};
let nextTtsId = 1;
const activeTts = new Map<number, { startedAt: number; meta: any }>();
let turn: { t0: number; firstAudioMs: number | null } | null = null;
const logLines: string[] = [];

function log(...parts: unknown[]) {
  const line = `${new Date().toISOString().slice(11, 19)} ${parts.map(String).join(" ")}`;
  logLines.push(line);
  if (logLines.length > 60) logLines.shift();
  console.log(line);
}

function sendToAll(obj: Record<string, unknown>) {
  const data = JSON.stringify(obj);
  for (const ws of sockets) ws.send(data);
}

function setState(state: "idle" | "listening" | "thinking" | "speaking") {
  sendToAll({ type: "state", state });
}

function fs() {
  return require("node:fs") as typeof import("node:fs");
}

function exists(path: string): boolean {
  try {
    return fs().existsSync(path);
  } catch {
    return false;
  }
}

// ----------------------------------------------------------- local engine ---
function ensureStt() {
  if (stt) return;
  const models: Record<string, string> = {};
  const modelsDir = useNative ? NATIVE_MODELS : MODELS_DIR;
  const envSpec = process.env.VOICE_STT_MODELS;
  if (envSpec) {
    for (const pair of envSpec.split(",")) {
      const [lang, path] = pair.split(":");
      if (lang && path) models[lang] = path;
    }
  } else {
    const en = `${modelsDir}/vosk-model-small-en-us-0.15`;
    // Full MSA models first (quality), Tunisian small model as fallback (RAM).
    const arCandidates = [
      "vosk-model-ar-0.22",
      "vosk-model-ar-0.22-linto-1.1.0",
      "vosk-model-small-ar-tn-0.1-linto",
    ];
    if (exists(en)) models.en = en;
    const ar = arCandidates.map((n) => `${modelsDir}/${n}`).find((p) => exists(p));
    if (ar) models.ar = ar;
  }
  if (useNative) {
    ensureNative();
    stt = native!.stt;
  } else {
    stt = spawnJsonLineWorker(`${PKG}/python/stt_worker.py`, onSttMessage);
  }
  stt.send({ type: "config", models });
  log(`stt local worker ready (${useNative ? "native" : "python"}), models:`, Object.keys(models).join(",") || "none");
}

// -------------------------------------------------------- native backend ----
let native: ReturnType<typeof spawnNativeBackend> | null = null;

function ensureNative() {
  if (native) return;
  native = spawnNativeBackend({
    binary: NATIVE_BIN,
    modelsDir: NATIVE_MODELS,
    supertonicOnnx: `${NATIVE_MODELS}/supertonic3/onnx`,
    supertonicStyles: `${NATIVE_MODELS}/supertonic3/voice_styles`,
    cloudCfg,
    voice: config.voice,
    log,
    onStt: onSttMessage,
    onCloud: onCloudMessage,
    onTts: onTtsMessage,
  });
  log(`native sidecar spawned: ${NATIVE_BIN}`);
}

function onSttMessage(m: Record<string, any>) {
  if (m.type === "partial") {
    if (config.sttEngine === "local") sendToAll({ type: "stt-partial", text: m.text, lang: m.lang });
    return;
  }
  if (m.type === "final") {
    if (config.sttEngine !== "local") return; // stale final after engine switch
    acceptTranscript(String(m.text ?? ""), (m.lang ?? "en") as "en" | "ar", m.confidence, "local");
    return;
  }
  if (m.type === "loaded") log("stt model loaded:", m.lang, `in ${m.load_s}s`);
  if (m.type === "error") log("STT-ERROR", m.message);
}

// ----------------------------------------------------------- cloud engine ---
function ensureCloudStt() {
  if (cloud) return;
  if (useNative) {
    ensureNative();
    cloud = native!.cloud;
  } else {
    cloud = spawnJsonLineWorker(`${PKG}/python/stt_cloud_worker.py`, onCloudMessage);
  }
  cloud.send({ type: "config", ...cloudCfg, hasKey: Boolean(process.env[cloudCfg.apiKeyEnv]) });
  log(`stt cloud worker ready (${useNative ? "native" : "python"}; ${cloudCfg.provider} / ${cloudCfg.model})`);
}

function onCloudMessage(m: Record<string, any>) {
  if (m.type === "ready") {
    cloudInfo = { provider: m.provider, model: m.model, hasKey: Boolean(m.hasKey) };
    sendToAll({ type: "cloud-info", ...cloudInfo });
    if (!m.hasKey && m.provider !== "mock") {
      log("cloud engine has no API key — will fall back to local on first use");
    }
    return;
  }
  if (m.type === "info") return; // rtt telemetry, reserved for HUD
  if (m.type === "final") {
    if (config.sttEngine !== "cloud") return; // stale final after engine switch
    acceptTranscript(String(m.text ?? ""), (m.lang ?? "en") as "en" | "ar", m.confidence, "cloud");
    return;
  }
  if (m.type === "error") {
    if (m.kind === "cloud-fallback") {
      log("cloud STT failed:", m.message, "→ falling back to local engine");
      config.sttEngine = "local";
      sendToAll({ type: "config", config, notice: `cloud STT failed (${String(m.message).slice(0, 120)}) — switched to local engine` });
    } else {
      log("STT-CLOUD-ERROR", m.message);
    }
  }
}

// ---------------------------------------------------- transcript pipeline ---
function acceptTranscript(
  raw: string,
  lang: "en" | "ar",
  confidence: unknown,
  engine: "local" | "cloud",
) {
  const corrected = config.autoCorrect ? correctTranscript(raw, lang) : { corrected: raw, corrections: [] };
  sendToAll({
    type: "stt-final",
    raw,
    corrected: corrected.corrected,
    corrections: corrected.corrections,
    lang,
    confidence,
    engine,
  });
  handleStudent(corrected.corrected, lang, engine === "cloud" ? "stt-cloud" : "stt");
}

function handleStudent(text: string, lang: "en" | "ar", source: "stt" | "stt-cloud" | "typed" | "inject") {
  if (!text.trim()) return;
  turn = { t0: Date.now(), firstAudioMs: null };
  setState("thinking");
  sendToAll({ type: "student-accepted", text, lang, source });
  const reply = pickReply(text, lang);
  log(`student (${source}, ${lang}): ${text.slice(0, 60)}`);
  void streamTeacher(reply, lang);
}

// ------------------------------------------------------------------- tts ----
function dispatchChunk(text: string, lang: "en" | "ar") {
  const speakable = speakableForm(text, lang);
  const id = nextTtsId++;
  activeTts.set(id, { startedAt: Date.now(), meta: null });
  sendToAll({ type: "teacher-chunk", id, text, lang });
  tts?.send({ type: "synth", id, text: speakable, lang, steps: config.steps, speed: config.speed });
}

async function streamTeacher(text: string, lang: "en" | "ar") {
  const chunker = new StreamingChunker({ maxChars: 220 });
  const tokens = text.split(/(\s+)/);
  for (const tok of tokens) {
    for (const chunk of chunker.push(tok)) dispatchChunk(chunk, lang);
    await sleep(90);
  }
  for (const chunk of chunker.flush()) dispatchChunk(chunk, lang);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --------------------------------------------------------- tts worker -------
let tts: JsonLineWorker | null = null;

function ensureTts() {
  if (tts) return;
  if (useNative) {
    ensureNative();
    tts = native!.tts;
  } else {
    tts = spawnJsonLineWorker(`${PKG}/python/tts_worker.py`, onTtsMessage);
  }
  tts.send({ type: "config", voice: config.voice });
  log(`tts worker ready (${useNative ? "native" : "python"}; supertonic-3)`);
}

function onTtsMessage(m: Record<string, any>) {
  if (m.type === "ready") {
    log(`tts ready: sample_rate=${m.sample_rate} voice=${m.voice}`);
    sendToAll({ type: "tts-ready", sampleRate: m.sample_rate, voice: m.voice });
    cacheStudentQuestions();
    return;
  }
  if (m.type === "tts-meta") {
    const entry = activeTts.get(m.id);
    if (entry) entry.meta = { ...(entry.meta ?? {}), ...m };
    sendToAll(m);
    return;
  }
  if (m.type === "tts-audio") {
    const entry = activeTts.get(m.id);
    if (entry?.meta?.cache) {
      cacheAudio[m.id] = cacheAudio[m.id] ? b64FromConcat(cacheAudio[m.id], m.b64) : m.b64;
      return;
    }
    if (turn && turn.firstAudioMs === null && m.id < 900000) {
      turn.firstAudioMs = Date.now() - turn.t0;
      sendToAll({
        type: "metrics",
        firstAudioMs: turn.firstAudioMs,
        label: "student-final → first TTS audio",
      });
      log(`first-audio latency: ${turn.firstAudioMs}ms`);
    }
    sendToAll(m);
    return;
  }
  if (m.type === "tts-done" || m.type === "tts-cancelled") {
    const entry = activeTts.get(m.id);
    activeTts.delete(m.id);
    if (entry?.meta?.cache) {
      writeCacheWav(m.id, entry.meta.cacheName, entry.meta.sample_rate ?? 44100);
      return;
    }
    sendToAll(m);
    if (activeTts.size === 0) setState("idle");
    return;
  }
  if (m.type === "error") log("TTS-ERROR", m.message);
}

// ------------------------------------------------------------- tts helpers ---
const cacheAudio: Record<number, string> = {};

function b64FromConcat(a: string, b: string): string {
  const ab = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  return Buffer.concat([ab, bb]).toString("base64");
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function writeCacheWav(id: number, name: string, sampleRate: number) {
  const b64 = cacheAudio[id];
  delete cacheAudio[id];
  if (!b64) return;
  const pcm = Buffer.from(b64, "base64");
  try {
    fs().mkdirSync(CACHE_DIR, { recursive: true });
    fs().writeFileSync(`${CACHE_DIR}/${name}.wav`, pcmToWav(pcm, sampleRate));
    log(`cache written: ${name}.wav (${(pcm.length / 2 / sampleRate).toFixed(1)}s)`);
  } catch (e) {
    log("cache write failed", String(e));
  }
}

function cacheStudentQuestions() {
  const jobs: { id: number; text: string; lang: "en" | "ar"; name: string }[] = [
    { id: 900001, text: "What is photosynthesis and why is it important?", lang: "en", name: "student-en" },
    { id: 900002, text: "ما هو البناء الضوئي ولماذا هو مهم؟", lang: "ar", name: "student-ar" },
  ];
  fs().mkdirSync(CACHE_DIR, { recursive: true });
  for (const job of jobs) {
    if (exists(`${CACHE_DIR}/${job.name}.wav`)) continue;
    activeTts.set(job.id, { startedAt: Date.now(), meta: { cache: true, cacheName: job.name } });
    tts?.send({ type: "synth", id: job.id, text: job.text, lang: job.lang, steps: config.steps, speed: config.speed });
  }
}

function bargeIn() {
  for (const id of [...activeTts.keys()]) {
    if (id >= 900000) continue;
    tts?.send({ type: "cancel", id });
  }
  sendToAll({ type: "tts-interrupted", ids: [...activeTts.keys()] });
  setState("idle");
  log("barge-in: TTS queue cancelled");
}

// -------------------------------------------------------------------- http ---
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".md": "text/plain; charset=utf-8",
};

function serveFile(path: string): Response | null {
  try {
    if (!exists(path)) return null;
    const ext = path.slice(path.lastIndexOf("."));
    const body = fs().readFileSync(path);
    return new Response(body, { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } });
  } catch {
    return null;
  }
}

let wsSeq = 0;

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/voice/ws") {
      const ok = server.upgrade(req, { data: { id: wsSeq++ } });
      if (ok) return new Response(null, { status: 101 });
      return new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname.startsWith("/cache/")) {
      const name = url.pathname.slice("/cache/".length).replace(/[^a-zA-Z0-9.-]/g, "");
      return serveFile(`${CACHE_DIR}/${name}`) ?? new Response("not cached yet", { status: 404 });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveFile(`${PKG}/web/index.html`) ?? new Response("missing web/index.html", { status: 500 });
    }
    const file = serveFile(`${PKG}/web${url.pathname}`);
    if (file) return file;
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({
        type: "hello",
        config,
        cloud: cloudInfo,
        log: logLines.slice(-25),
      }));
      log(`client connected (#${wsSeq})`);
    },
    close(ws) {
      sockets.delete(ws);
    },
    message(ws, msg) {
      ensureStt();
      ensureTts();
      if (config.sttEngine === "cloud") ensureCloudStt();
      if (msg instanceof ArrayBuffer || ArrayBuffer.isView(msg)) {
        const bytes = msg instanceof ArrayBuffer ? new Uint8Array(msg) : new Uint8Array((msg as DataView).buffer);
        const b64 = Buffer.from(bytes).toString("base64");
        const worker = config.sttEngine === "cloud" ? cloud : stt;
        worker?.send({ type: "audio", b64, lang: config.sttLang });
        return;
      }
      let m: Record<string, any>;
      try {
        m = JSON.parse(String(msg));
      } catch {
        return;
      }
      switch (m.type) {
        case "voice-config": {
          const engineChanged = m.sttEngine && m.sttEngine !== config.sttEngine;
          if (m.sttEngine === "local" || m.sttEngine === "cloud") config.sttEngine = m.sttEngine;
          if (m.sttLang) config.sttLang = m.sttLang;
          if (m.steps) config.steps = Number(m.steps);
          if (m.speed) config.speed = Number(m.speed);
          if (typeof m.autoCorrect === "boolean") config.autoCorrect = m.autoCorrect;
          stt?.send({ type: "reset" });
          if (engineChanged && config.sttEngine === "cloud") {
            ensureCloudStt();
            cloud?.send({ type: "reset" });
          }
          sendToAll({ type: "config", config, cloud: cloudInfo });
          log("config:", JSON.stringify(config));
          break;
        }
        case "mic-active": {
          setState(m.active ? "listening" : "idle");
          break;
        }
        case "stt-flush":
          (config.sttEngine === "cloud" ? cloud : stt)?.send({ type: "flush" });
          break;
        case "stt-inject": {
          // Perfect-STT simulation (no mic): text enters as if recognized.
          const lang = (m.lang ?? "en") as "en" | "ar";
          acceptTranscript(String(m.text), lang, 1, config.sttEngine);
          break;
        }
        case "student-final":
          handleStudent(String(m.text), (m.lang ?? "en") as "en" | "ar", m.source ?? "typed");
          break;
        case "barge-in":
          bargeIn();
          break;
        case "get-log":
          ws.send(JSON.stringify({ type: "log", lines: logLines }));
          break;
        default:
          break;
      }
    },
  },
});

log(`voice gateway on http://localhost:${PORT} (M0 demo, backend=${useNative ? "native" : "python"}, STT engine=${config.sttEngine})`);
