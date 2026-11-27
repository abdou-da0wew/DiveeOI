//! divee-voice — the DiveeOI voice sidecar (Rust).
//!
//! One long-lived NDJSON child process per server (`--serve`), mirroring the
//! divee-retrieval sidecar contract (see packages/learning/native/retrieval and
//! docs/voice-mode/PLAN.md §3):
//!
//! requests  in:  {"id":N,"op":"...","...":...}
//! responses out: {"id":N,"ok":true,"result":{...}} | {"id":N,"ok":false,"error":"..."}
//! events    out: {"event":"...","...":...}   (no "id" — async pushes)
//!
//! ops:
//!   stt.config        {models:{en:...,"ar":...}}                    -> result {models:[..]}
//!   stt.audio         {b64,lang:"en"|"ar"|"auto",engine}            -> ok
//!   stt.flush         {engine}                                      -> ok (finals emitted)
//!   stt.reset         -> ok
//!   stt.cloud.config  {provider,baseUrl,model,apiKeyEnv}            -> result {provider,model,hasKey}
//!   tts.config        {onnxDir,voiceStylesDir,voice,threads}        -> result {sampleRate,voice}
//!   tts.synth         {sid,text,lang,steps,speed}                   -> ok (events carry audio)
//!   tts.cancel        {sid}                                         -> ok
//!   shutdown                                                        -> ok, exits
//!
//! events:
//!   stt.loaded {lang,load_ms}   stt.partial {lang,text}   stt.final {lang,text,confidence,engine?}
//!   stt.error  {kind,message}   tts.ready {sample_rate,voice}   tts.meta {sid,sample_rate,audio_s,wall_ms}
//!   tts.audio  {sid,seq,b64}    tts.done {sid,rtf,audio_s,wall_ms}   tts.cancelled {sid}

mod stt;
mod tts;
mod tts_helper;

use anyhow::Result;
use base64::Engine;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;

use stt::{CloudStt, LocalStt};
use tts::{Engine as TtsEngine, SynthOutcome};

// ---------------------------------------------------------------------------
// ONNX Runtime environment (same discovery order as divee-retrieval embed.rs)
// ---------------------------------------------------------------------------

fn dylib_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("ORT_DYLIB_PATH") {
        out.push(PathBuf::from(p));
    }
    for dir in [
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu",
        "/usr/local/lib",
        "/usr/lib",
    ] {
        out.push(PathBuf::from(dir).join("libonnxruntime.so"));
    }
    // pip installs (user venvs) — scan the common capi layout
    for base in ["/usr/lib/python3/dist-packages", "/usr/local/lib/python3.12", "/home/z/.venv/lib/python3.12"] {
        let capi = PathBuf::from(base).join("onnxruntime/capi");
        if let Ok(entries) = std::fs::read_dir(&capi) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("libonnxruntime.so") {
                    out.push(entry.path());
                }
            }
        }
    }
    out
}

fn init_ort() -> Result<Arc<ort::environment::Environment>, String> {
    let dylib = dylib_candidates()
        .into_iter()
        .find(|p| p.exists())
        .ok_or("no onnxruntime shared library found (set ORT_DYLIB_PATH or install onnxruntime)")?;
    ort::environment::init_from(&dylib)
        .map(|env| Arc::new(env))
        .map_err(|error| format!("onnxruntime init failed from {}: {error}", dylib.display()))
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

fn emit(line: &Value) {
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{line}");
    let _ = lock.flush();
}

fn respond(id: u64, result: Result<Value, String>) {
    let line = match result {
        Ok(result) => json!({ "id": id, "ok": true, "result": result }),
        Err(error) => json!({ "id": id, "ok": false, "error": error }),
    };
    emit(&line);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |name: &str| -> Option<String> {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1).cloned())
    };
    let serve = args.iter().any(|a| a == "--serve");
    if !serve {
        eprintln!("divee-voice: start with --serve (NDJSON over stdin/stdout)");
        std::process::exit(2);
    }
    let default_dir = |sub: &str| -> PathBuf {
        arg("--models-dir")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()))
                    .join("models")
            })
            .join(sub)
    };
    let supertonic_onnx = arg("--supertonic-onnx")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_dir("supertonic3/onnx"));
    let supertonic_styles = arg("--supertonic-styles")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_dir("supertonic3/voice_styles"));
    let default_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .clamp(1, 4);

    vosk::set_log_level(vosk::LogLevel::Warnings);

    let mut local = LocalStt::new();
    let mut cloud = CloudStt::new();
    let mut tts_engine: Option<TtsEngine> = None;
    let environment: Arc<ort::environment::Environment> = match init_ort() {
        Ok(env) => env,
        Err(err) => {
            // The TTS engine degrades to "not configured"; STT keeps working.
            emit(&json!({ "event": "tts.error", "message": err }));
            Arc::new(
                ort::environment::init_from("libonnxruntime.so")
                    .expect("onnxruntime must be loadable by name for STT-free operation"),
            )
        }
    };

    if let Ok(vosk_lib) = std::env::var("DIVEEOI_VOICE_LIBVOSK_DIR") {
        // optional; the vendored lib/ path is baked at link time
        let _ = vosk_lib;
    }

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(trimmed) {
            Ok(msg) => msg,
            Err(err) => {
                respond(0, Err(format!("bad json: {err}")));
                continue;
            }
        };
        let id = msg.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        let op = msg.get("op").and_then(|v| v.as_str()).unwrap_or("").to_string();

        let result: Result<Value, String> = (|| {
            match op.as_str() {
                "stt.config" => {
                    let models: std::collections::HashMap<String, String> = msg
                        .get("models")
                        .and_then(|v| v.as_object())
                        .map(|obj| {
                            obj.iter()
                                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                                .collect()
                        })
                        .unwrap_or_default();
                    Ok(local.configure(&models))
                }
                "stt.audio" => {
                    let b64 = msg
                        .get("b64")
                        .and_then(|v| v.as_str())
                        .ok_or("stt.audio missing b64")?;
                    let lang = msg.get("lang").and_then(|v| v.as_str()).unwrap_or("en");
                    let engine = msg.get("engine").and_then(|v| v.as_str()).unwrap_or("local");
                    match engine {
                        "cloud" => cloud.feed(b64, lang).map(|_| json!({})),
                        _ => {
                            let pcm = base64::engine::general_purpose::STANDARD
                                .decode(b64)
                                .map_err(|e| format!("bad audio base64: {e}"))?;
                            let samples: Vec<i16> = pcm
                                .chunks_exact(2)
                                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                                .collect();
                            let mut failures = Vec::new();
                            {
                                let mut emit_ref = |v: Value| emit(&v);
                                if let Err(err) = local.feed(&samples, lang, &mut emit_ref) {
                                    failures.push(format!("{err}"));
                                }
                            }
                            if failures.is_empty() {
                                Ok(json!({}))
                            } else {
                                Err(failures.join("; "))
                            }
                        }
                    }
                }
                "stt.flush" => {
                    let engine = msg.get("engine").and_then(|v| v.as_str()).unwrap_or("local");
                    let mut emit_ref = |v: Value| emit(&v);
                    match engine {
                        "cloud" => cloud.flush(&mut emit_ref).map(|_| json!({})),
                        _ => local.flush(&mut emit_ref).map(|_| json!({})),
                    }
                }
                "stt.reset" => {
                    local.reset();
                    cloud.reset();
                    Ok(json!({}))
                }
                "stt.cloud.config" => Ok(cloud.configure(
                    msg.get("provider").and_then(|v| v.as_str()),
                    msg.get("baseUrl").and_then(|v| v.as_str()),
                    msg.get("model").and_then(|v| v.as_str()),
                    msg.get("apiKeyEnv").and_then(|v| v.as_str()),
                )),
                "tts.config" => {
                    let voice = msg.get("voice").and_then(|v| v.as_str()).unwrap_or("M1").to_string();
                    let threads = msg
                        .get("threads")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as usize)
                        .unwrap_or(default_threads)
                        .clamp(1, 8);
                    let engine = TtsEngine::load(
                        &environment,
                        &supertonic_onnx.to_string_lossy(),
                        &supertonic_styles.to_string_lossy(),
                        &voice,
                        threads,
                    )
                    .map_err(|e| format!("{e:#}"))?;
                    let sample_rate = engine.sample_rate();
                    emit(&tts::ready_payload(sample_rate, &voice));
                    tts_engine = Some(engine);
                    Ok(json!({ "sampleRate": sample_rate, "voice": voice }))
                }
                "tts.synth" => {
                    let engine = tts_engine
                        .as_mut()
                        .ok_or("tts.synth before tts.config")?;
                    let sid = msg.get("sid").and_then(|v| v.as_u64()).unwrap_or(0);
                    let text = msg
                        .get("text")
                        .and_then(|v| v.as_str())
                        .ok_or("tts.synth missing text")?;
                    let lang = msg.get("lang").and_then(|v| v.as_str()).unwrap_or("en");
                    let steps = msg.get("steps").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
                    let speed = msg.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.05) as f32;
                    let sample_rate = engine.sample_rate();
                    let mut seq: u64 = 0;
                    let mut buffered: Vec<u8> = Vec::new();
                    let mut first = true;
                    let outcome = engine.synth(sid, text, lang, steps, speed, |slice| {
                        if first {
                            // wall time to first sample arrives with tts.meta
                            first = false;
                        }
                        buffered.extend_from_slice(slice);
                        while buffered.len() >= stt_slices::CHUNK {
                            let frame: Vec<u8> = buffered.drain(..stt_slices::CHUNK).collect();
                            emit(&json!({
                                "event": "tts.audio",
                                "sid": sid,
                                "seq": seq,
                                "b64": base64::engine::general_purpose::STANDARD.encode(&frame),
                            }));
                            seq += 1;
                        }
                    });
                    // drain remainder
                    if !buffered.is_empty() {
                        emit(&json!({
                            "event": "tts.audio",
                            "sid": sid,
                            "seq": seq,
                            "b64": base64::engine::general_purpose::STANDARD.encode(&buffered[..]),
                        }));
                    }
                    match outcome {
                        Ok(SynthOutcome::Done { audio_s, wall_ms }) => {
                            emit(&json!({
                                "event": "tts.meta",
                                "sid": sid,
                                "sample_rate": sample_rate,
                                "audio_s": (audio_s * 1000.0).round() / 1000.0,
                                "wall_ms": wall_ms,
                            }));
                            emit(&json!({
                                "event": "tts.done",
                                "sid": sid,
                                "rtf": (wall_ms as f64 / 1000.0 / audio_s.max(1e-6) * 1000.0).round() / 1000.0,
                                "audio_s": (audio_s * 1000.0).round() / 1000.0,
                                "wall_ms": wall_ms,
                            }));
                            Ok(json!({ "audioS": audio_s, "wallMs": wall_ms }))
                        }
                        Ok(SynthOutcome::Cancelled) => {
                            emit(&json!({ "event": "tts.cancelled", "sid": sid }));
                            Ok(json!({ "cancelled": true }))
                        }
                        Err(err) => Err(format!("{err:#}")),
                    }
                }
                "tts.cancel" => {
                    if let Some(engine) = tts_engine.as_mut() {
                        engine.cancel(msg.get("sid").and_then(|v| v.as_u64()).unwrap_or(0));
                    }
                    Ok(json!({}))
                }
                "shutdown" => Ok(json!({ "bye": true })),
                other => Err(format!("unknown op: {other}")),
            }
        })();
        respond(id, result);
        if op == "shutdown" {
            break;
        }
    }

    // ONNX Runtime sessions can crash during Drop on some platforms; the
    // upstream binding uses _exit for the same reason.
    unsafe {
        libc::_exit(0);
    }
}

mod stt_slices {
    pub const CHUNK: usize = 8192; // 4096 int16 samples per tts.audio frame
}
