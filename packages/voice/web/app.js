/**
 * DiveeOI voice-mode M0 demo client.
 *
 * Real pipeline, scripted teacher: mic/cached-audio → 16kHz PCM16 → WS →
 * gateway (vosk local / cloud STT) → transcript (raw→corrected) → scripted
 * teacher stream → chunked supertonic-3 TTS → gapless AudioContext playback.
 *
 * Everything on this page also documents the model provenance: supertonic-3
 * weights are OpenRAIL-M (attribution in the pipeline log on tts.ready).
 */
"use strict";

// ---------------------------------------------------------------- plumbing ---
const $ = (id) => document.getElementById(id);
const els = {
  badgeStt: $("badge-stt"), badgeTts: $("badge-tts"),
  selEngine: $("sel-engine"), selLang: $("sel-lang"), selSteps: $("sel-steps"),
  selSpeed: $("sel-speed"), chkAuto: $("chk-autocorrect"),
  transcript: $("transcript"), listening: $("listening"), partial: $("partial-text"),
  micPill: $("mic-pill"), prompt: $("prompt-input"), send: $("send-btn"),
  stateChip: $("state-chip"), wave: $("waveform"),
  mPartial: $("m-partial"), mFinal: $("m-final"), mFirst: $("m-firstaudio"),
  mTtsMs: $("m-ttsms"), mRtf: $("m-rtf"), mQueue: $("m-queue"),
  metricsNote: $("metrics-note"), log: $("pipeline-log"),
};

let ws = null;
let ttsSampleRate = 44100;
let cloudInfo = { provider: null, model: null, hasKey: false };

function log(line) {
  const t = new Date().toISOString().slice(11, 19);
  const div = document.createElement("div");
  div.textContent = `${t}  ${line}`;
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
  while (els.log.childElementCount > 60) els.log.removeChild(els.log.firstChild);
}

function setState(state) {
  els.stateChip.textContent = state;
  els.stateChip.className = `state-chip ${state}`;
}

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/voice/ws`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => log("ws connected");
  ws.onclose = () => {
    log("ws closed — retrying in 1s");
    setState("idle");
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    handleMessage(m);
  };
}

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ------------------------------------------------------------------ audio ----
const audio = {
  ctx: null,
  queue: [],           // scheduled BufferSources (for barge-in)
  nextTime: 0,         // gapless scheduling clock
  playing: new Set(),
};
function audioCtx() {
  if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
  return audio.ctx;
}

function b64ToPcm16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function playPcmChunk(b64) {
  const ctx = audioCtx();
  const samples = b64ToPcm16(b64);
  const buffer = ctx.createBuffer(1, samples.length, ttsSampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 32768;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  const now = ctx.currentTime;
  if (audio.nextTime < now) audio.nextTime = now + 0.02;
  src.start(audio.nextTime);
  audio.nextTime += buffer.duration;
  audio.queue.push(src);
  src.onended = () => {
    audio.playing.delete(src);
    const idx = audio.queue.indexOf(src);
    if (idx >= 0) audio.queue.splice(idx, 1);
    updateQueueTile();
    if (audio.queue.length === 0 && !speaking) setState("idle");
  };
  audio.playing.add(src);
  updateQueueTile();
}

function stopAllPlayback() {
  for (const src of [...audio.queue, ...audio.playing]) { try { src.stop(); } catch { /* */ } }
  audio.queue.length = 0;
  audio.playing.clear();
  audio.nextTime = 0;
  updateQueueTile();
}

function updateQueueTile() {
  els.mQueue.textContent = String(audio.queue.length);
}

// ------------------------------------------------------------------ typing ---
function detectLang(text) {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function addStudentBubble({ raw, corrected, corrections = [], lang, confidence, engine, source }) {
  const div = document.createElement("div");
  div.className = `bubble student ${lang === "ar" ? "ar" : ""}`;
  const dir = lang === "ar" ? "rtl" : "ltr";
  div.dir = dir;
  const correctedSame = corrected === raw;
  div.innerHTML = `
    <div class="who">student · ${engine ?? source ?? "typed"}${lang === "ar" ? " · AR" : " · EN"}</div>
    <div class="text"></div>
    <div class="meta"></div>`;
  const textEl = div.querySelector(".text");
  if (!correctedSame) {
    const rawSpan = document.createElement("span");
    rawSpan.className = "raw";
    rawSpan.style.textDecoration = "line-through";
    rawSpan.style.opacity = "0.6";
    rawSpan.textContent = raw;
    textEl.appendChild(rawSpan);
    textEl.appendChild(document.createTextNode(" → " + corrected));
  } else {
    textEl.textContent = raw;
  }
  const chips = document.createElement("div");
  chips.className = "chips";
  if (corrections.length) {
    for (const c of corrections) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${c.from} → ${c.to}`;
      chips.appendChild(chip);
    }
  }
  if (confidence !== undefined && confidence !== null) {
    const conf = document.createElement("span");
    conf.className = "conf";
    conf.textContent = `conf ${(Number(confidence) * 100).toFixed(0)}%`;
    chips.appendChild(conf);
  }
  if (chips.childElementCount) div.querySelector(".meta").appendChild(chips);
  els.transcript.appendChild(div);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function addTeacherBubble(chunk) {
  const div = document.createElement("div");
  div.className = `bubble teacher ${chunk.lang === "ar" ? "ar" : ""}`;
  div.dir = chunk.lang === "ar" ? "rtl" : "ltr";
  div.dataset.chunkId = String(chunk.id);
  div.innerHTML = `<div class="who">teacher · supertonic-3</div><div class="text"></div>`;
  div.querySelector(".text").textContent = chunk.text;
  els.transcript.appendChild(div);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

// ----------------------------------------------------------------- messages ---
let turnStart = null;
let firstPartialMs = null;

function handleMessage(m) {
  switch (m.type) {
    case "hello": {
      applyConfig(m.config);
      cloudInfo = m.cloud ?? cloudInfo;
      for (const line of m.log ?? []) log(line);
      updateBadges();
      break;
    }
    case "tts-ready":
      ttsSampleRate = m.sample_rate ?? 44100;
      els.badgeTts.textContent = `TTS supertonic-3 · ready (${m.voice})`;
      els.badgeTts.classList.add("ok");
      log(`tts ready: ${ttsSampleRate}Hz voice=${m.voice} — supertonic-3 weights: OpenRAIL-M (Supertone/supertonic-3)`);
      break;
    case "cloud-info":
      cloudInfo = m;
      updateBadges();
      break;
    case "config":
      applyConfig(m.config);
      if (m.notice) log(`⚠ ${m.notice}`);
      updateBadges();
      break;
    case "state":
      if (m.state === "speaking") speaking = true;
      if (m.state === "idle") speaking = false;
      setState(m.state);
      break;
    case "stt-partial": {
      els.listening.classList.remove("hidden");
      els.partial.textContent = m.text;
      els.partial.dir = m.lang === "ar" ? "rtl" : "ltr";
      els.partial.classList.toggle("ar", m.lang === "ar");
      if (turnStart && firstPartialMs === null) {
        firstPartialMs = Date.now() - turnStart;
        els.mPartial.textContent = `${firstPartialMs}ms`;
      }
      break;
    }
    case "stt-final": {
      els.listening.classList.add("hidden");
      els.partial.textContent = "";
      if (turnStart) els.mFinal.textContent = `${Date.now() - turnStart}ms`;
      addStudentBubble(m);
      log(`student (${m.engine ?? m.source ?? "?"}, ${m.lang}): ${String(m.corrected ?? m.raw).slice(0, 48)}`);
      break;
    }
    case "student-accepted":
      turnStart = turnStart ?? Date.now();
      break;
    case "teacher-chunk":
      addTeacherBubble(m);
      break;
    case "tts-meta":
      if (m.wall_ms) els.mTtsMs.textContent = `${m.wall_ms}ms`;
      break;
    case "tts-done":
      if (m.rtf) els.mRtf.textContent = Number(m.rtf).toFixed(2);
      break;
    case "tts-cancelled":
      log("tts cancelled by barge-in");
      break;
    case "tts-interrupted":
      stopAllPlayback();
      log(`barge-in: ${m.ids?.length ?? 0} chunk(s) cancelled`);
      break;
    case "metrics":
      els.mFirst.textContent = `${m.firstAudioMs}ms`;
      els.metricsNote.textContent = `${m.label} · ${new Date().toLocaleTimeString()}`;
      log(`⏱ ${m.label}: ${m.firstAudioMs}ms`);
      break;
    case "log":
      for (const line of m.lines ?? []) log(line);
      break;
    default:
      break;
  }
}

let speaking = false;

function applyConfig(cfg) {
  if (!cfg) return;
  if (cfg.sttEngine) els.selEngine.value = cfg.sttEngine;
  if (cfg.sttLang) els.selLang.value = cfg.sttLang;
  if (cfg.steps) els.selSteps.value = String(cfg.steps);
  if (cfg.speed) els.selSpeed.value = String(cfg.speed);
  if (typeof cfg.autoCorrect === "boolean") els.chkAuto.checked = cfg.autoCorrect;
}

function updateBadges() {
  if (els.selEngine.value === "cloud") {
    const p = cloudInfo.provider ?? "?";
    const key = cloudInfo.hasKey ? "key ✓" : "no key → falls back to local";
    els.badgeStt.textContent = `STT cloud: ${p}${cloudInfo.model ? `/${cloudInfo.model}` : ""} · ${key}`;
    els.badgeStt.classList.toggle("ok", Boolean(cloudInfo.hasKey) || p === "mock");
  } else {
    els.badgeStt.textContent = "STT local: vosk en ✓ ar ✓ (on-device)";
    els.badgeStt.classList.add("ok");
  }
}

// ------------------------------------------------------------- mic capture ---
const mic = { stream: null, node: null, ctx: null, on: false, silenceMs: 0, sawSpeech: false };

async function toggleMic() {
  if (mic.on) {
    mic.on = false;
    els.micPill.classList.remove("on");
    send({ type: "mic-active", active: false });
    try { mic.node?.disconnect(); mic.stream?.getTracks().forEach((t) => t.stop()); mic.ctx?.close(); } catch { /* */ }
    mic.stream = mic.node = mic.ctx = null;
    drawWave(null);
    return;
  }
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
    mic.ctx = new AudioContext();
    const src = mic.ctx.createMediaStreamSource(mic.stream);
    const proc = mic.ctx.createScriptProcessor(4096, 1, 1);
    mic.node = proc;
    src.connect(proc);
    proc.connect(mic.ctx.destination);
    mic.on = true;
    mic.silenceMs = 0;
    mic.sawSpeech = false;
    els.micPill.classList.add("on");
    send({ type: "mic-active", active: true });
    setState("listening");
    turnStart = Date.now();
    firstPartialMs = null;
    proc.onaudioprocess = (e) => {
      if (!mic.on) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = downsampleTo16k(input, mic.ctx.sampleRate);
      if (ws && ws.readyState === 1) ws.send(pcm16.buffer);
      drawWave(input);
      // endpointing: 600ms of silence after speech triggers a flush
      let peak = 0;
      for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]));
      const voiced = peak > 0.02;
      if (voiced) { mic.sawSpeech = true; mic.silenceMs = 0; }
      else if (mic.sawSpeech) {
        mic.silenceMs += (input.length / mic.ctx.sampleRate) * 1000;
        if (mic.silenceMs >= 600) {
          mic.sawSpeech = false;
          mic.silenceMs = 0;
          send({ type: "stt-flush" });
        }
      }
    };
    log("mic on — speak, then pause; endpointing flushes at 600ms silence");
  } catch (err) {
    log(`mic denied/unavailable: ${err.message ?? err}`);
  }
}

function downsampleTo16k(input, fromRate) {
  const ratio = fromRate / 16000;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    // block-average downsample (adequate for speech STT)
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const v = sum / Math.max(1, end - start);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

// ---------------------------------------------------------------- waveform ---
function drawWave(data) {
  const ctx = els.wave.getContext("2d");
  const { width, height } = els.wave;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#4f7cff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (!data) {
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }
  const step = Math.max(1, Math.floor(data.length / width));
  for (let x = 0; x < width; x++) {
    let peak = 0;
    for (let j = 0; j < step && x * step + j < data.length; j++) {
      peak = Math.max(peak, Math.abs(data[x * step + j]));
    }
    const y = height / 2 - peak * height * 0.45;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// --------------------------------------------------------------- simulate ----
async function simulateFromWav(path, label, lang) {
  stopAllPlayback();
  // The sim drives the same visible config a real student would: switching
  // language first ensures vosk uses the right recognizer (or auto).
  if (lang && els.selLang.value !== lang) {
    els.selLang.value = lang;
    els.selLang.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 400)); // let voice-config propagate
  }
  els.transcript.appendChild(Object.assign(document.createElement("div"), {
    className: "who",
    textContent: `── simulate: ${label} ──`,
  })).style.opacity = "0.5";
  turnStart = Date.now();
  firstPartialMs = null;
  setState("listening");
  send({ type: "mic-active", active: true });
  let bytes;
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`cache miss: ${path} (${res.status})`);
    const buf = await res.arrayBuffer();
    if (path.includes("-16k")) {
      // already 16kHz mono s16 — feed directly (deterministic in headless too)
      bytes = new Uint8Array(buf.slice(44));
    } else {
      // 44.1k wav: render down to 16k via OfflineAudioContext
      const probe = new AudioContext();
      const decoded = await probe.decodeAudioData(buf);
      probe.close();
      const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      const rendered = await off.startRendering();
      const f32 = rendered.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
      bytes = new Uint8Array(i16.buffer);
    }
  } catch (err) {
    log(`simulate failed: ${err.message ?? err}`);
    setState("idle");
    return;
  }
  const FRAME = 3200; // 100ms of 16kHz mono s16
  drawWaveResampled(bytes);
  let off = 0;
  const tick = () => {
    if (off + FRAME > bytes.length) {
      send({ type: "stt-flush" });
      send({ type: "mic-active", active: false });
      return;
    }
    if (ws && ws.readyState === 1) ws.send(bytes.slice(off, off + FRAME));
    off += FRAME;
    setTimeout(tick, 90); // slightly faster than realtime keeps the demo snappy
  };
  tick();
}

function drawWaveResampled(bytes) {
  // waveform preview straight from the s16 byte stream
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1);
  const ctx = els.wave.getContext("2d");
  const { width, height } = els.wave;
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#4f7cff";
  ctx.beginPath();
  const per = Math.max(1, Math.floor(samples.length / width));
  for (let x = 0; x < width; x++) {
    let peak = 0;
    for (let j = 0; j < per; j++) {
      const s = Math.abs(samples[x * per + j] ?? 0) / 32768;
      if (s > peak) peak = s;
    }
    const y = height / 2 - peak * height * 0.45;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ------------------------------------------------------------------ config ---
for (const [el, ev] of [[els.selEngine, "change"], [els.selLang, "change"], [els.selSteps, "change"], [els.selSpeed, "change"], [els.chkAuto, "change"]]) {
  el.addEventListener(ev, () => {
    send({
      type: "voice-config",
      sttEngine: els.selEngine.value,
      sttLang: els.selLang.value,
      steps: Number(els.selSteps.value),
      speed: Number(els.selSpeed.value),
      autoCorrect: els.chkAuto.checked,
    });
    updateBadges();
  });
}

// ------------------------------------------------------------------ events ---
els.micPill.addEventListener("click", toggleMic);
els.send.addEventListener("click", submitPrompt);
els.prompt.addEventListener("keydown", (e) => { if (e.key === "Enter") submitPrompt(); });

function submitPrompt() {
  const text = els.prompt.value.trim();
  if (!text) return;
  els.prompt.value = "";
  turnStart = Date.now();
  firstPartialMs = null;
  const lang = detectLang(text);
  send({ type: "student-final", text, lang, source: "typed" });
}

const SIM_EN = "/cache/probe-en-16k.wav";
const SIM_AR = "/cache/probe-ar-16k.wav";
$("sim-en").addEventListener("click", () => simulateFromWav(SIM_EN, "EN voice → STT", "en"));
$("sim-ar").addEventListener("click", () => simulateFromWav(SIM_AR, "AR voice → STT", "ar"));
$("sim-ar-text").addEventListener("click", () => {
  turnStart = Date.now();
  firstPartialMs = null;
  send({ type: "stt-inject", text: "ما هو البناء الضوئي ولماذا هو مهم؟", lang: "ar" });
});
$("sim-bargein").addEventListener("click", () => {
  stopAllPlayback();
  send({ type: "barge-in" });
});

// -------------------------------------------------------------------- boot ---
connect();
drawWave(null);
log("voice-mode M0 — teacher replies are scripted; STT/TTS pipeline is real");
