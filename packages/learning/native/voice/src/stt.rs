//! STT engines for the divee-voice sidecar.
//!
//! Two interchangeable engines behind one NDJSON protocol (see docs/voice-mode/PLAN.md §2):
//! - [`LocalStt`]  — vosk on-device, streaming partials, lazy per-language models.
//! - [`CloudStt`]  — any OpenAI-compatible /audio/transcriptions endpoint (batch,
//!   finals only), plus a `mock` provider for CI. The API key is read from an env
//!   var NAME at call time; it is never logged or echoed.

use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Instant;
use vosk::{CompleteResult, DecodingState, Model, Recognizer};

pub const SAMPLE_RATE: f32 = 16_000.0;

fn word_confidence(words: &[vosk::Word]) -> f32 {
    if words.is_empty() {
        return 0.6;
    }
    words.iter().map(|w| w.conf).sum::<f32>() / words.len() as f32
}

fn complete_to_parts(res: &CompleteResult) -> Option<(String, f32)> {
    match res {
        CompleteResult::Single(single) => {
            let text = single.text.trim().to_string();
            if text.is_empty() {
                None
            } else {
                Some((text, word_confidence(&single.result)))
            }
        }
        CompleteResult::Multiple(multi) => multi
            .alternatives
            .first()
            .map(|alt| (alt.text.trim().to_string(), 0.6f32))
            .filter(|(text, _)| !text.is_empty()),
    }
}

// ---------------------------------------------------------------------------
// Local (vosk) engine
// ---------------------------------------------------------------------------

pub struct LocalStt {
    paths: HashMap<String, String>,
    models: HashMap<String, Model>,
    recs: HashMap<String, Recognizer>,
    auto: bool,
    pending_finals: HashMap<String, (String, f32)>,
}

impl LocalStt {
    pub fn new() -> Self {
        Self {
            paths: HashMap::new(),
            models: HashMap::new(),
            recs: HashMap::new(),
            auto: false,
            pending_finals: HashMap::new(),
        }
    }

    pub fn configure(&mut self, models: &HashMap<String, String>) -> Value {
        self.paths = models.clone();
        json!({ "models": models.keys().cloned().collect::<Vec<_>>() })
    }

    fn load(&mut self, lang: &str, emit: &mut dyn FnMut(Value)) -> Result<&mut Model> {
        if !self.models.contains_key(lang) {
            let path = self
                .paths
                .get(lang)
                .cloned()
                .ok_or_else(|| anyhow!("no model path configured for lang={lang}"))?;
            let t0 = Instant::now();
            let model =
                Model::new(path).ok_or_else(|| anyhow!("vosk model load failed for lang={lang}"))?;
            self.models.insert(lang.to_string(), model);
            emit(json!({
                "event": "stt.loaded",
                "lang": lang,
                "load_ms": t0.elapsed().as_millis() as u64,
            }));
        }
        Ok(self.models.get_mut(lang).expect("model just inserted"))
    }

    fn ensure_rec(&mut self, lang: &str, emit: &mut dyn FnMut(Value)) -> Result<&mut Recognizer> {
        if !self.recs.contains_key(lang) {
            let model = self.load(lang, emit)?;
            let mut rec = Recognizer::new(model, SAMPLE_RATE)
                .ok_or_else(|| anyhow!("recognizer creation failed for lang={lang}"))?;
            rec.set_words(true);
            self.recs.insert(lang.to_string(), rec);
        }
        Ok(self.recs.get_mut(lang).expect("recognizer just inserted"))
    }

    fn active_langs(&mut self, lang: &str) -> Vec<String> {
        if lang == "auto" {
            self.auto = true;
            self.paths.keys().cloned().collect()
        } else {
            vec![lang.to_string()]
        }
    }

    pub fn feed(&mut self, pcm: &[i16], lang: &str, emit: &mut dyn FnMut(Value)) -> Result<()> {
        for l in self.active_langs(lang) {
            let rec = self.ensure_rec(&l, emit)?;
            match rec.accept_waveform(pcm) {
                Ok(DecodingState::Finalized) => {
                    let res = rec.result();
                    if let Some((text, conf)) = complete_to_parts(&res) {
                        self.emit_final(&l, text, conf, emit);
                    }
                }
                Ok(_) => {
                    let partial = rec.partial_result().partial.trim().to_string();
                    if !partial.is_empty() {
                        emit(json!({ "event": "stt.partial", "lang": l, "text": partial }));
                    }
                }
                Err(err) => {
                    return Err(anyhow!("vosk accept_waveform failed for lang={l}: {err}"));
                }
            }
        }
        Ok(())
    }

    fn emit_final(&mut self, lang: &str, text: String, conf: f32, emit: &mut dyn FnMut(Value)) {
        if self.auto && self.paths.len() > 1 {
            self.pending_finals.insert(lang.to_string(), (text, conf));
            let loaded: Vec<String> = self.paths.keys().cloned().collect();
            let have_all = loaded.iter().all(|l| self.pending_finals.contains_key(l));
            if have_all {
                let winner = loaded
                    .iter()
                    .max_by(|a, b| {
                        let ca = self.pending_finals.get(*a).map(|x| x.1).unwrap_or(-1.0);
                        let cb = self.pending_finals.get(*b).map(|x| x.1).unwrap_or(-1.0);
                        ca.total_cmp(&cb)
                    })
                    .cloned();
                if let Some(winner) = winner {
                    if let Some((text, conf)) = self.pending_finals.remove(&winner) {
                        emit(json!({
                            "event": "stt.final",
                            "lang": winner,
                            "text": text,
                            "confidence": (conf * 1000.0).round() / 1000.0,
                        }));
                    }
                }
            }
        } else {
            emit(json!({
                "event": "stt.final",
                "lang": lang,
                "text": text,
                "confidence": (conf * 1000.0).round() / 1000.0,
            }));
        }
    }

    pub fn flush(&mut self, emit: &mut dyn FnMut(Value)) -> Result<()> {
        let langs: Vec<String> = self.recs.keys().cloned().collect();
        for l in langs {
            let rec = self.recs.get_mut(&l).expect("lang key from map");
            let res = rec.final_result();
            if let Some((text, conf)) = complete_to_parts(&res) {
                self.emit_final(&l, text, conf, emit);
            }
        }
        self.reset();
        Ok(())
    }

    pub fn reset(&mut self) {
        self.recs.clear();
        self.pending_finals.clear();
    }
}

// ---------------------------------------------------------------------------
// Cloud engine (OpenAI-compatible /audio/transcriptions) + mock
// ---------------------------------------------------------------------------

pub struct CloudStt {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
    pub has_key: bool,
    buffer: Vec<u8>,
    lang: String,
}

impl CloudStt {
    pub fn new() -> Self {
        Self {
            provider: String::new(),
            base_url: String::new(),
            model: String::new(),
            api_key_env: "DIVEEOI_VOICE_CLOUD_STT_API_KEY".into(),
            has_key: false,
            buffer: Vec::new(),
            lang: "en".into(),
        }
    }

    pub fn configure(
        &mut self,
        provider: Option<&str>,
        base_url: Option<&str>,
        model: Option<&str>,
        api_key_env: Option<&str>,
    ) -> Value {
        if let Some(p) = provider {
            self.provider = p.to_string();
        }
        if let Some(u) = base_url {
            self.base_url = u.to_string();
        }
        if let Some(m) = model {
            self.model = m.to_string();
        }
        if let Some(e) = api_key_env {
            self.api_key_env = e.to_string();
        }
        self.has_key = std::env::var(&self.api_key_env).is_ok_and(|k| !k.trim().is_empty());
        json!({
            "provider": self.provider,
            "model": self.model,
            "hasKey": self.has_key,
        })
    }

    pub fn feed(&mut self, b64: &str, lang: &str) -> Result<()> {
        self.lang = lang.to_string();
        let pcm = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| anyhow!("bad audio base64: {e}"))?;
        self.buffer.extend_from_slice(&pcm);
        Ok(())
    }

    pub fn flush(&mut self, emit: &mut dyn FnMut(Value)) -> Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        let result = self.transcribe();
        self.buffer.clear();
        match result {
            Ok(text) if !text.is_empty() => {
                emit(json!({
                    "event": "stt.final",
                    "lang": self.lang,
                    "text": text,
                    "confidence": Value::Null,
                    "engine": "cloud",
                }));
                Ok(())
            }
            Ok(_) => Ok(()),
            Err(err) => {
                emit(json!({
                    "event": "stt.error",
                    "kind": "cloud-fallback",
                    "message": format!("{err}"),
                }));
                Ok(())
            }
        }
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
    }

    fn transcribe(&self) -> Result<String> {
        if self.provider == "mock" {
            std::thread::sleep(std::time::Duration::from_millis(50));
            return Ok(if self.lang == "ar" {
                "ما هو البناء الضوئي ولماذا هو مهم؟".to_string()
            } else {
                "What is photosynthesis and why is it important?".to_string()
            });
        }
        if self.base_url.is_empty() {
            bail!("cloud STT base URL not configured");
        }
        let key = std::env::var(&self.api_key_env).unwrap_or_default();
        if key.trim().is_empty() {
            bail!("no API key in env {}", self.api_key_env);
        }
        let wav = pcm16_to_wav(&self.buffer);
        let boundary = format!("diveevoice{}", std::process::id());
        let mut body: Vec<u8> = Vec::with_capacity(wav.len() + 512);
        {
            let mut field = |name: &str, value: &str| {
                body.extend_from_slice(
                    format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                        .as_bytes(),
                );
            };
            field("model", &self.model);
            field("language", if self.lang == "ar" { "ar" } else { "en" });
            field("response_format", "json");
            field("temperature", "0");
            body.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"utterance.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
                )
                .as_bytes(),
            );
        }
        body.extend_from_slice(&wav);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(30))
            .build();
        let response = agent
            .post(&self.base_url)
            .set("Authorization", &format!("Bearer {key}"))
            .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
            .send(&body[..])
            .map_err(|e| anyhow!("cloud STT request failed: {e}"))?;
        let parsed: Value = response
            .into_json()
            .map_err(|e| anyhow!("cloud STT response parse failed: {e}"))?;
        Ok(parsed
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim()
            .to_string())
    }
}

fn pcm16_to_wav(pcm: &[u8]) -> Vec<u8> {
    let mut wav = Vec::with_capacity(pcm.len() + 44);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&(SAMPLE_RATE as u32).to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE as u32 * 2).to_le_bytes()); // byte rate
    wav.extend_from_slice(&2u16.to_le_bytes()); // block align
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(pcm);
    wav
}
