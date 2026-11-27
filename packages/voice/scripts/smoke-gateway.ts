/**
 * End-to-end smoke test for the voice gateway (native backend). Run while the
 * gateway is up; assumes assets/cache/student-*.wav have already been written
 * (they are produced automatically after tts.ready, and the smoke script also
 * waits for them so TTS latency numbers are not skewed by the cache jobs).
 *
 * Exercises: hello/config → scripted EN injection → teacher TTS stream +
 * first-audio metric → barge-in → engine switch to cloud (mock) → binary PCM
 * upload + flush → cloud final.
 *
 * Usage: bun scripts/smoke-gateway.ts [wsUrl] [cloudWav] [realWav16k]
 *   cloudWav   any wav — only buffered bytes for the mock provider
 *   realWav16k 16kHz mono s16 wav fed to the LOCAL vosk engine for a real
 *              recognition round-trip (produce with ffmpeg -ar 16000)
 * Exit 0 = all checks passed, 1 = failure (details printed).
 */
import { existsSync, readFileSync, statSync } from "node:fs";

const WS_URL = process.argv[2] ?? "ws://localhost:4747/voice/ws";
const WAV = process.argv[3] ?? "assets/cache/student-en.wav";
const REAL_WAV = process.argv[4] ?? "assets/cache/student-en-16k.wav";
const CACHE = new URL("../assets/cache/", import.meta.url).pathname.slice(0, -1);

const seen: { type: string; m: any; t: number }[] = [];
const waiters: { type: string; pred?: (m: any) => boolean; resolve: (m: any) => void; timer: ReturnType<typeof setTimeout> }[] = [];

function onEvent(m: any) {
  seen.push({ type: String(m.type ?? "?"), m, t: Date.now() });
  for (let i = 0; i < waiters.length; i++) {
    const w = waiters[i];
    if (w.type === m.type && (!w.pred || w.pred(m))) {
      waiters.splice(i, 1);
      clearTimeout(w.timer);
      w.resolve(m);
      return;
    }
  }
}

function expect(type: string, pred?: (m: any) => boolean, timeoutMs = 90_000): Promise<any> {
  return expectAfter(0, type, pred, timeoutMs);
}

// Marker-anchored wait: only messages ARRIVING after `marker` (an earlier
// seen.length snapshot) can satisfy this — avoids stale-event false positives.
function expectAfter(marker: number, type: string, pred?: (m: any) => boolean, timeoutMs = 90_000): Promise<any> {
  const have = seen.slice(marker).find((s) => s.type === type && (!pred || pred(s.m)));
  if (have) return Promise.resolve(have.m);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.findIndex((w) => w.type === type);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new Error(`timeout waiting for "${type}"; last events: ${seen.slice(marker).slice(-6).map((s) => s.type).join(",")}`));
    }, timeoutMs);
    waiters.push({ type, pred, resolve, timer });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForCache() {
  for (const name of ["student-en.wav", "student-ar.wav"]) {
    const p = `${CACHE}/${name}`;
    const t0 = Date.now();
    while (!existsSync(p) || statSync(p).size < 2000) {
      if (Date.now() - t0 > 150_000) throw new Error(`cache wav never appeared: ${p}`);
      await sleep(500);
    }
    console.log(`cache ready: ${name} (${statSync(p).size} bytes)`);
  }
}

const ws = new WebSocket(WS_URL);
ws.onmessage = (ev) => {
  try {
    const m = JSON.parse(String(ev.data));
    console.log(`[recv] ${m.type ?? m.type_ ?? "?"}${m.type === undefined ? ` event=${m.event ?? ""}` : ""}`);
    onEvent(m);
  } catch { /* non-JSON */ }
};

const open = new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws error")); });
const results: Record<string, unknown> = {};
let failures = 0;

function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  if (!ok) failures++;
  results[name] = detail;
}

const sendJson = (obj: Record<string, unknown>) => {
  console.log(`[send] ${obj.type}`);
  ws.send(JSON.stringify(obj));
};

await open;
console.log("[ws open]");
await expect("hello");

// --- local engine, scripted EN injection ------------------------------------
sendJson({ type: "voice-config", sttEngine: "local", sttLang: "en" });
await expect("config", (m) => m.config?.sttEngine === "local");

await waitForCache();

const tInject = Date.now();
sendJson({ type: "stt-inject", text: "What is photosynthesis?", lang: "en" });
const fin = await expect("stt-final", (m) => m.engine === "local");
check("stt-final(local)", true, { raw: fin.raw, corrected: fin.corrected, corrections: fin.corrections?.length ?? 0 });
await expect("student-accepted");
const chunk = await expect("teacher-chunk");
check("teacher-chunk", typeof chunk.text === "string" && chunk.text.length > 0, chunk.text);
const audio = await expect("tts-audio", (m) => typeof m.b64 === "string" && m.b64.length > 0);
check("tts-audio frames", true, `first frame seq=${audio.seq}, ${Math.round(audio.b64.length * 0.75 / 2 / 44100 * 1000)}ms of audio`);
const metric = await expect("metrics");
check("first-audio latency", typeof metric.firstAudioMs === "number", `${metric.firstAudioMs}ms (${metric.label})`);
results.injectToFinalMs = Date.now() - tInject;

// --- barge-in ----------------------------------------------------------------
sendJson({ type: "barge-in" });
const interrupted = await expect("tts-interrupted");
check("barge-in", Array.isArray(interrupted.ids), `cancelled ids: ${JSON.stringify(interrupted.ids)}`);

// --- cloud engine (mock provider) via binary PCM ------------------------------
sendJson({ type: "voice-config", sttEngine: "cloud", sttLang: "en" });
await expect("config", (m) => m.config?.sttEngine === "cloud");
await expect("cloud-info").catch(() => check("cloud-info", false, "never received (mock)"));

const wav = readFileSync(WAV);
const pcm = wav.subarray(44); // strip RIFF header; 16-bit mono PCM
check("student wav pcm", pcm.length > 32000, `${(pcm.length / 2 / 44100).toFixed(1)}s @44.1kHz`);
const FRAME = 3200; // 100ms @16kHz mono s16
const markerCloud = seen.length;
for (let off = 0; off + FRAME <= pcm.length; off += FRAME) {
  ws.send(pcm.slice(off, off + FRAME)); // mock provider only buffers bytes
}
sendJson({ type: "stt-flush" });
const cfin = await expectAfter(markerCloud, "stt-final", (m) => m.engine === "cloud", 30_000);
check("stt-final(cloud)", typeof cfin.corrected === "string" && cfin.corrected.length > 0, cfin.corrected);

// --- real STT round-trip: 16kHz wav through the LOCAL vosk engine ------------
sendJson({ type: "voice-config", sttEngine: "local", sttLang: "en" });
await expect("config", (m) => m.config?.sttEngine === "local");
const real = readFileSync(REAL_WAV);
const realPcm = real.subarray(44);
check("real wav pcm @16k", realPcm.length > 16000, `${(realPcm.length / 2 / 16000).toFixed(1)}s @16kHz`);
const markerReal = seen.length;
for (let off = 0; off + FRAME <= realPcm.length; off += FRAME) {
  ws.send(realPcm.slice(off, off + FRAME));
}
sendJson({ type: "stt-flush" });
const rfin = await expectAfter(markerReal, "stt-final", (m) => m.engine === "local", 120_000);
const got = String(rfin.corrected ?? "").toLowerCase();
check("stt-final(local, real audio)", got.includes("photosynth"), { raw: rfin.raw, corrected: rfin.corrected, confidence: rfin.confidence });

ws.close();
console.log("=== event types seen:", [...new Set(seen.map((s) => s.type))].join(", "));
console.log(JSON.stringify({ ...results, failures }, null, 2));
process.exit(failures === 0 ? 0 : 1);
