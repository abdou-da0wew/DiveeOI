/**
 * divee-voice sidecar probe: spawns the Rust binary directly (no gateway) and
 * verifies the full protocol round-trip:
 *   tts.config → tts.ready → tts.synth (EN + AR) → wav files
 *   stt.config → stt.audio (16k PCM frames) → stt.flush → stt.final (EN + AR)
 *   stt.cloud.config (mock) → stt.audio(engine=cloud) → flush → cloud final
 *
 * Outputs: <voice-pkg>/assets/cache/probe-en.wav (+ probe-en-16k.wav),
 *          probe-ar.wav (+ probe-ar-16k.wav) — the 16k files double as fixtures
 *          for scripts/smoke-gateway.ts.
 * Exit 0 = all checks passed.
 *
 * Usage: bun scripts/sidecar-probe.ts [steps=5]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const VOICE_PKG = new URL("..", import.meta.url).pathname.slice(0, -1); // packages/voice
const NATIVE_DIR = new URL("../../learning/native/voice/", import.meta.url).pathname.slice(0, -1);
const BIN = `${NATIVE_DIR}/target/release/divee-voice`;
const MODELS = `${NATIVE_DIR}/models`;
const CACHE = `${VOICE_PKG}/assets/cache`;
const STEPS = Number(process.argv[2] ?? 5);

if (!existsSync(BIN)) {
  console.error(`sidecar binary not found: ${BIN} (cargo build --release first)`);
  process.exit(2);
}
mkdirSync(CACHE, { recursive: true });

// --- tiny NDJSON client ------------------------------------------------------
const proc = Bun.spawn([BIN, "--serve", "--models-dir", MODELS], {
  stdin: "pipe", stdout: "pipe", stderr: "inherit",
  env: {
    ...process.env,
    // Vendored libvosk.so fallback (the rpath from build.rs usually covers it)
    LD_LIBRARY_PATH: `${NATIVE_DIR}/lib${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ""}`,
  },
});
const events: any[] = [];
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let reqId = 1;
let exited: Promise<number> | null = null;

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
      const m = JSON.parse(line);
      if (m.event !== undefined) {
        events.push(m);
        continue;
      }
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        if (m.ok) p.resolve(m.result ?? {});
        else p.reject(new Error(String(m.error)));
      }
    }
  }
})();
exited = proc.exited;

function send(obj: Record<string, unknown>): { id: number } {
  const id = reqId++;
  proc.stdin.write(JSON.stringify({ id, ...obj }) + "\n");
  return { id };
}

function request(obj: Record<string, unknown>, timeoutMs = 60_000): Promise<any> {
  const { id } = send(obj);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout on op=${obj.op}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
  });
}

function waitFor(event: string, pred?: (m: any) => boolean, timeoutMs = 120_000): Promise<any> {
  const have = events.find((m) => m.event === event && (!pred || pred(m)));
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const m = events.find((e) => e.event === event && (!pred || pred(e)));
      if (m) { clearInterval(iv); resolve(m); return; }
      if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error(`timeout waiting for event ${event}`)); }
    }, 50);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- wav helpers -------------------------------------------------------------
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function b64ToPcm(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

function to16k(src: string, dst: string) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", dst]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(0, 300)}`);
}

// --- checks ------------------------------------------------------------------
let failures = 0;
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  if (!ok) failures++;
}

async function synthToFile(sid: number, text: string, lang: "en" | "ar", name: string) {
  const t0 = Date.now();
  send({ op: "tts.synth", sid, text, lang, steps: STEPS, speed: 1.05 });
  const meta = await waitFor("tts.meta", (m) => m.sid === sid);
  const done = await waitFor("tts.done", (m) => m.sid === sid);
  const frames = events.filter((m) => m.event === "tts.audio" && m.sid === sid);
  const pcm = Buffer.concat(frames.map((f) => b64ToPcm(f.b64)));
  const sr = meta.sample_rate ?? 44100;
  writeFileSync(`${CACHE}/${name}.wav`, pcmToWav(pcm, sr));
  to16k(`${CACHE}/${name}.wav`, `${CACHE}/${name}-16k.wav`);
  return {
    sampleRate: sr, bytes: pcm.length, seconds: pcm.length / 2 / sr,
    wallMs: done.wall_ms, rtf: done.rtf, firstFrameMs: Date.now() - t0,
    frames: frames.length,
  };
}

async function sttRoundTrip(wavPath: string, lang: "en" | "ar", engine: "local" | "cloud") {
  const t0 = Date.now();
  const wav = readFileSync(wavPath);
  const pcm = wav.subarray(44);
  const FRAME = 3200; // 100ms @16k
  for (let off = 0; off + FRAME <= pcm.length; off += FRAME) {
    send({ op: "stt.audio", b64: pcm.subarray(off, off + FRAME).toString("base64"), lang, engine });
    await sleep(4); // near-realtime pace so partials behave like live speech
  }
  send({ op: "stt.flush", engine });
  const fin = await waitFor("stt.final", (m) => (engine === "cloud" ? m.engine === "cloud" : m.engine === undefined) && (lang === "auto" || m.lang === lang), 60_000);
  return { text: String(fin.text ?? ""), confidence: fin.confidence, wallMs: Date.now() - t0 };
}

try {
  // TTS up
  const tcfg = await request({ op: "tts.config", voice: "M1", threads: 4 });
  const ready = await waitFor("tts.ready");
  check("tts.ready", true, `sample_rate=${ready.sample_rate} voice=${ready.voice} (sr=${tcfg.sampleRate})`);

  // EN synth + AR synth
  const en = await synthToFile(1, "What is photosynthesis and why is it important?", "en", "probe-en");
  check("tts.synth(en)", en.seconds > 2 && en.frames > 10, `${en.seconds.toFixed(1)}s audio, wall=${en.wallMs}ms, rtf=${en.rtf}, ${en.frames} frames`);
  const ar = await synthToFile(2, "ما هو البناء الضوئي ولماذا هو مهم؟", "ar", "probe-ar");
  check("tts.synth(ar)", ar.seconds > 2 && ar.frames > 10, `${ar.seconds.toFixed(1)}s audio, wall=${ar.wallMs}ms, rtf=${ar.rtf}, ${ar.frames} frames`);

  // STT models up
  const enModel = `${MODELS}/vosk-model-small-en-us-0.15`;
  const arModel = [`${MODELS}/vosk-model-ar-0.22`, `${MODELS}/vosk-model-ar-0.22-linto-1.1.0`, `${MODELS}/vosk-model-small-ar-tn-0.1-linto`]
    .find((p) => existsSync(p))!;
  const scfg = await request({ op: "stt.config", models: { en: enModel, ar: arModel } });
  check("stt.config", Array.isArray(scfg.models) && scfg.models.length === 2, scfg.models);

  // EN round-trip (local vosk)
  const enStt = await sttRoundTrip(`${CACHE}/probe-en-16k.wav`, "en", "local");
  check("stt.final(en, real audio)", enStt.text.includes("photosynth"), { text: enStt.text, confidence: enStt.confidence, wallMs: enStt.wallMs });

  // AR round-trip (local vosk)
  const arStt = await sttRoundTrip(`${CACHE}/probe-ar-16k.wav`, "ar", "local");
  const arOk = arStt.text.length > 3 && /بناء|ضوئ|ضو/.test(arStt.text);
  check("stt.final(ar, real audio)", arOk, { text: arStt.text, confidence: arStt.confidence, wallMs: arStt.wallMs });

  // Cloud engine (mock provider)
  const ccfg = await request({ op: "stt.cloud.config", provider: "mock", baseUrl: "", model: "mock", apiKeyEnv: "DIVEEOI_VOICE_CLOUD_STT_API_KEY" });
  check("stt.cloud.config", ccfg.provider === "mock", ccfg);
  const cloudStt = await sttRoundTrip(`${CACHE}/probe-en-16k.wav`, "en", "cloud");
  check("stt.final(cloud mock)", cloudStt.text.toLowerCase().includes("photosynthesis"), { text: cloudStt.text, wallMs: cloudStt.wallMs });
} catch (e) {
  failures++;
  console.log("FAIL probe aborted:", (e as Error).message);
} finally {
  send({ op: "shutdown" });
  await sleep(300);
  try { proc.kill(); } catch { /* already gone */ }
}

console.log("=== events seen:", [...new Set(events.map((m) => m.event))].join(", "));
console.log("=== fix:", failures === 0 ? "ALL CHECKS PASSED" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
