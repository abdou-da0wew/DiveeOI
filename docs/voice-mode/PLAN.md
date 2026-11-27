# Voice Mode — Talking Teacher (Targeted Learning first, whole Agent next)

Branch: `feature/voice-mode` · planned 2026-11-27 · status: **M0 demo in this branch**

## 1. Goal

The targeted-learning teacher gets a voice. The student can talk to it with the
mic and it talks back — while the answer text is still streaming out of the LLM.
Everything runs **locally** by default (no cloud STT/TTS), the STT layer is
**pluggable: on-device AND cloud API**, supports **Arabic + English**, is fast
enough to feel conversational, and has **auto-correction built in**. Shipped
first as a standalone demo, then wired into the TL prompt input, then
generalized to the whole agent.

Non-goals for M0: touching the real LLM pipeline (teacher stream is
scripted/simulated), no voice cloning, no cloud TTS.

## 2. Engines (researched + installed 2026-11-27)

### TTS — Supertonic-3 (local, both languages)
- `Supertone/supertonic-3` on HF: 99 M params, **ONNX Runtime on CPU**, no
  GPU/cloud needed; **31 ISO languages including `en` and `ar`** (plus `"na"`
  unknown-language fallback).
- `pip install supertonic` (v1.2.2); `TTS(auto_download=True)` downloads
  ~400 MB ONNX weights + voice-style JSON once into
  `packages/voice/models/supertonic` (via `SUPERTONIC_CACHE_DIR`).
- API: `tts.synthesize(text, voice_style, lang="ar", total_steps=8, speed=1.05)`
  → `(wav, duration)`; `tts.sample_rate` (44.1 kHz); 10 built-in voices
  (`M1..M5`, `F1..F5`).
- **No native streaming** (explicitly documented) → our low-latency path is
  **application-level sentence chunking + per-chunk synthesis with pipeline
  overlap** (§4). `total_steps` is the quality/latency knob (2 fastest → 8
  best). Threads via `SUPERTONIC_INTRA_OP_THREADS` (4 on the i5).
- License: Python code MIT; weights **OpenRAIL-M** (use-based restrictions) —
  attribution note kept in README; educational use is fine.

### STT — pluggable engine abstraction: **device AND cloud**
One JSON-lines protocol, two engines, selected from the voice settings in the
prompt-input place (`sttEngine: "local" | "cloud"`):

| | engine `local` (default) | engine `cloud` |
| --- | --- | --- |
| Backend | Vosk (Kaldi) in `python/stt_worker.py` | any **OpenAI-compatible** `/audio/transcriptions` endpoint in `python/stt_cloud_worker.py` |
| Defaults | `vosk-model-small-en-us-0.15` (40 MB, WER 9.85 % librispeech) + `vosk-model-ar-0.22` (1.5 GB MSA, ~2 GB RAM, lazy-loaded) + `vosk-model-small-ar-tn-0.1-linto` (158 MB fallback) | Groq `whisper-large-v3` (fast, strong Arabic) — base URL/model overridable (`VOICE_CLOUD_STT_BASE_URL`, `VOICE_CLOUD_STT_MODEL`) so OpenAI/Azure/local whisper.cpp-server all work |
| Partials | streaming, sub-150 ms | finals only in M0 (batch API); true cloud streaming WS = M1 option (Deepgram/AssemblyAI style) |
| Network | none — fully offline | required; adds ~300–800 ms RTT |
| Privacy | audio never leaves the machine | **only when the student selects cloud** |
| Keys | none | read from env var name `VOICE_CLOUD_STT_API_KEY` — never stored, logged, or committed |

- Fallback policy: cloud error (no key, network down, 4xx/5xx) → session
  switches to `local` automatically and the UI is notified; the local engine is
  always spawned, so fallback is instant.
- `provider: "mock"` returns canned EN/AR transcripts with no network — used by
  CI and the sandbox demo of the cloud path.
- Vosk ships abi3 wheels → Python 3.12 OK. Phrase-list/grammar adaptation
  (alphacephei.com/vosk/lm) is the local engine's domain-boost hook (§5).
- Evaluated alternatives: sherpa-onnx streaming zipformer (no MSA streaming
  model published yet — watch item), whisper.cpp (better accuracy, not
  streaming — can be plugged into the same cloud worker as a local
  OpenAI-compatible server).

## 3. Architecture (M0 demo shape = M1 production shape)

```
browser (packages/voice/web)                     AudioWorklet: 16 kHz mono PCM16
   │  mic frames (WS binary, 100 ms)             AudioContext: gapless PCM queue
   ▼
voice gateway (bun, src/server.ts)               WS hub + static + HUD metrics
   │  JSON lines over stdio                       engine router: local ⇄ cloud
   ├─▶ python/stt_worker.py        vosk, lazy per-language models
   ├─▶ python/stt_cloud_worker.py  OpenAI-compatible / mock, finals
   ├─▶ python/tts_worker.py        supertonic-3 synth queue, PCM slices out
   └─▶ TL chat (M1: packages/server/src/session/processor.ts stream hook)
```

- Mic → VAD (energy gate M0, Silero-ONNX M1) → endpointing on 600 ms silence.
- STT emits **partial** events (local engine, live-painted) then **final** →
  corrector → send.
- Teacher stream → sentence chunker → TTS worker synth queue → PCM frames
  (base64 over WS) → browser queue. First chunk speaks while later chunks
  synthesize and later LLM tokens keep arriving.
- **Barge-in**: mic energy while teacher speaks → TTS queue flushed, WS sends
  `interrupt`; M1 additionally cancels the LLM stream.

## 4. Streamed text → TTS (the low-latency core)

`src/chunker.ts` (unit-tested):
- Boundaries: EN `. ! ?` ; AR `. ! ؟ ؛` — soft split on `, ، ;` only when a
  chunk exceeds softMax (110 chars); force split at maxChars (220).
- Protect abbreviations (`e.g.`, `Dr.`, `د.`, decimal numbers) via same-length
  masking so the boundary scan never fires inside them.
- minChars 14: tiny lead-ins ("Hi!", "سؤال ممتاز!") hold until the next
  boundary instead of producing a 2-word audio blip.
- First dispatch fires as soon as a boundary + min length is reached — the
  student hears the first sentence while the rest of the answer is still
  generating.
- Numbers/units → speakable forms per language via glossary (`6CO2` →
  "six C O two" / "ستة جزيئات ثاني أكسيد الكربون").

## 5. Auto-correction (built-in, three stages, nothing hidden)

1. **Domain boost (free)**: vosk phrase-list/grammar recompiled from the TL
   book glossary — biggest accuracy win for terms like "photosynthesis".
2. **Post-ASR fuzzy fixer** (`src/autocorrect.ts`): Damerau–Levenshtein ≤ 2
   against the domain lexicon (word-level EN/AR terms + stopwords immune);
   Arabic orthography normalization (أإآ→ا, ى→ي, ة→ه, strip tashkeel) before
   matching; distance-2 matches require a shared first letter.
3. **Optional tiny-LLM rewrite** (M1, off by default): "fix ASR errors only,
   never change meaning", 250 ms budget, only when stage-2 confidence is low.

The transcript UI always shows **raw → corrected** as a "did you mean" chip —
correction never silently rewrites what the student said.

## 6. UX in the prompt input (integration points)

- `packages/app/src/components/prompt-input.tsx`: **voice pill (mic) toggles
  Voice Mode** — exactly "enabled by the student in the prompt input place".
- State chip: idle → listening → thinking → speaking; partial transcript shown
  live; tap mic during teacher speech = barge-in; settings beside the pill:
  language (Auto/EN/AR), **STT engine (Local device / Cloud API)**, TTS steps,
  speed, auto-correct toggle.
- Teacher messages carry a speaker icon + waveform; the full text transcript is
  always visible (voice never replaces text — accessibility first).

## 7. Latency budget (targets, i5-10th-gen CPU)

| Stage | Budget |
| --- | --- |
| mic → gate | 10 ms |
| STT partial (local, streaming) | ≤ 150 ms after word onset |
| endpoint (silence) | 600 ms |
| corrector (lexicon) | ≤ 30 ms |
| cloud STT RTT (cloud engine) | ~300–800 ms (no partials in M0) |
| LLM first sentence | model-dependent (~600 ms) |
| chunk dispatch | ≤ 40 ms |
| supertonic first audio | measured in BENCH.md (RTF sweep across `total_steps`) |
| **student stops → teacher audible** | **target ≈ 1.2–2.0 s** |

Real measured numbers land in `docs/voice-mode/BENCH.md`.

## 8. Repo layout (this branch)

```
docs/voice-mode/PLAN.md (this file) · shots/*.png
packages/voice/
  src/server.ts         gateway: WS hub, engine router, static, metrics
  src/native.ts         adapter: one divee-voice sidecar ↔ three worker interfaces
  src/chunker.ts        EN/AR sentence chunker (unit-tested)
  src/autocorrect.ts    fuzzy + Arabic-orthography corrector (unit-tested)
  src/glossary.ts       TL domain lexicon seed (EN + AR words + phrases)
  src/teacher-texts.ts  scripted teacher answers (shared with bench)
  python/stt_worker.py        vosk EN/AR, lazy model load, JSON-lines
  python/stt_cloud_worker.py  OpenAI-compatible cloud STT + mock provider
  python/tts_worker.py        supertonic-3 queue worker, PCM slices
  python/warmup_tts.py        supertonic bootstrap + RTF check
  web/                  demo UI: index.html · styles.css · app.js (RTL-aware,
                        voice pill, engine selector, simulate bar, latency HUD)
  scripts/fetch-models.sh    vosk models + libvosk.so + supertonic-3 (resumable)
  scripts/sidecar-probe.ts   sidecar round-trip: EN/AR STT + TTS + cloud mock
  scripts/smoke-gateway.ts   full gateway smoke (native backend) incl. real audio
  models/ assets/cache/      gitignored
packages/learning/native/voice/   divee-voice — Rust sidecar (production path)
  src/main.rs           NDJSON serve protocol (mirrors divee-retrieval)
  src/stt.rs            LocalStt (vosk, streaming) + CloudStt (OpenAI-compat + mock)
  src/tts.rs + tts_helper.rs   supertonic-3 on ort 2.0.0-rc.15, chunked PCM out
  build.rs              vendored libvosk.so link + $ORIGIN rpath
  scripts/fetch-models.sh
```

M1 integration points (not touched in M0): `prompt-input.tsx` voice pill;
gateway mounted as server route `/voice/*`; `voice.*` settings keys.

## 9. Phases

- **M0 (this branch)** — standalone demo + probe/smoke + shots: proves the full
  EN+AR loop (mic/simulate → STT → correct → teacher stream → TTS → speaker),
  streaming TTS, correction, engine switching, HUD. Production backend is the
  Rust sidecar `divee-voice` (`VOICE_BACKEND=native|python|auto`); the python
  workers remain as a fallback. Cloud engine verified against the mock provider
  (real cloud needs a key from the student's machine).
- **M1** — real TL wiring: voice pill in the prompt input, `/voice/*` route,
  teacher stream → TTS hook in the session processor, settings keys, vosk
  grammar boost from the actual book glossary.
- **M2** — whole-agent voice: any session/agent can speak; speakable summaries
  of tool calls; barge-in cancels the LLM stream itself.
- **M3** — polish: TTS cache for repeated sentences, prosody/emotion params,
  lip-sync hooks for coenx-video avatars, cloud streaming partials (WS),
  whisper.cpp as a local "cloud-shaped" engine, browser-WASM fallback.

## 10. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| vosk ar-0.22 RAM (~2 GB) on 8 GB machine | lazy load + memory guard + `small-ar-tn` fallback; close other heavy views while listening |
| supertonic Arabic pronunciation quality | bench samples in BENCH.md; `total_steps`/voice tuning; glossary-speakable forms |
| supertonic has no native streaming | chunk pipeline overlap (§4) hides it; chunk synthesis is sequential but pipelined with playback |
| cloud STT latency / outage | engine is a setting, never a hard dependency; automatic fallback to local; mock provider for CI |
| API key leakage | key read from env var name at runtime; never written to disk/logs/git |
| browser autoplay policy | voice toggle is an explicit user gesture → AudioContext resume is legitimate |
| OpenRAIL-M obligations | no cloning of real people; attribution in README; disclosure note in UI |

## 11. M0 as-built — measured results (2026-11-27)

### Gateway backends

| `VOICE_BACKEND` | Processes | Notes |
| --- | --- | --- |
| `native` (default when binary exists) | Bun gateway + `divee-voice` sidecar | vosk STT + cloud STT + supertonic-3 TTS in ONE Rust process; protocol adapter in `src/native.ts` |
| `python` | Bun gateway + 3 python workers | fallback for hosts without a built binary |

STT engine is orthogonal and hot-switchable: `local` (vosk on-device, streaming
partials, en+ar) vs `cloud` (any OpenAI-compatible `/audio/transcriptions`
endpoint, or the built-in `mock` for CI). Cloud errors fall back to local
automatically (`kind: "cloud-fallback"`); the API key VALUE never crosses the
protocol — the sidecar reads the env var NAME at call time.

### Measured (sandbox, release build, steps=5)

| Check | Result |
| --- | --- |
| sidecar probe — TTS EN 3.3s utterance | wall 4466 ms, RTF 1.34, 36 streaming frames |
| sidecar probe — TTS AR 4.0s utterance | wall 4727 ms, RTF 1.20, 43 frames |
| sidecar probe — STT EN round-trip | "what is photosynthesis and why is it important", conf 0.98 |
| sidecar probe — STT AR round-trip | "ما هو البناء الضوئي ولماذا هو مهم", conf 0.999 |
| sidecar probe — cloud mock final | 191 ms (no network) |
| gateway smoke — inject → teacher chunks → TTS | first audio **2.6 s** (scripted 90 ms/token pacing included) |
| gateway smoke — real 16k wav → vosk → final | exact transcript, streaming partials |
| browser HUD (native backend) | STT partial 2.1 s (cold) / final 3.0 s / **first audio 1.3 s** / TTS chunk 1.4–2.3 s / RTF 0.25–0.49 |
| bun test | 18 pass / 0 fail (chunker + autocorrect) |

The 1.3 s browser first-audio (STT final → first TTS sample) is inside the
§7 budget; with the real LLM replacing the scripted 90 ms/token stream the
remaining work is chunk dispatch + first-chunk synthesis.

### Demo shots (`docs/voice-mode/shots/`)

| File | Shows |
| --- | --- |
| `01-idle.png` | idle UI: engine badges, settings bar, prompt bar with mic pill |
| `02-en-teacher.png` | EN voice → vosk STT (conf 100%) → streamed teacher chunks, HUD live |
| `03-ar-teacher.png` | AR voice → vosk AR → RTL transcript, autocorrect chip (ولماذا → لماذا), Arabic TTS reply |
| `04-barge-in.png` | barge-in mid-speech: playback cancelled, state reset |
| `05-cloud-engine.png` | engine = Cloud API (mock provider): badge shows fallback policy, cloud transcript |

### Run

```bash
# build sidecar + fetch models (once)
export CARGO_HOME=/home/z/my-project/toolchain/cargo RUSTUP_HOME=/home/z/my-project/toolchain/rustup
packages/learning/native/voice/scripts/fetch-models.sh && (cd packages/learning/native/voice && cargo build --release)
# gateway (auto-selects native)
cd packages/voice && bun src/server.ts   # http://localhost:4747
# probes
bun scripts/sidecar-probe.ts             # sidecar round-trip, writes 16k fixtures
bun scripts/smoke-gateway.ts             # full gateway smoke (gateway must be up)
bun test                                 # chunker + autocorrect unit tests
```

### Fixes landed with M0

- `build.rs`: bake `$ORIGIN/../../lib` rpath so `libvosk.so` resolves without LD_LIBRARY_PATH.
- `main.rs`: ONNX Runtime dylib scan now covers pip `site-packages/capi` layouts; missing dylib degrades TTS to "not configured" (clean `tts.error` + `tts.config` error) instead of panicking — STT keeps working.
- `fetch-models.sh`: corrected the doubled `onnx/onnx/` HF path (saved "Entry not found" bodies as weights); `curl --fail` + size guard for ONNX files.
- gateway `VOICE_BACKEND=native|python|auto` + protocol adapter with response correlation and cloud-ready synthesis; AR model candidate list picks the best installed MSA model.
