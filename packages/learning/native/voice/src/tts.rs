//! TTS engine wrapper around the vendored supertonic-3 pipeline.
//! Synthesizes whole utterances (the model has no native streaming); the
//! gateway pipelines at the sentence level, and this worker streams each
//! result back in PCM16 slices so playback can start immediately and barge-in
//! can drop the remainder mid-slice.

use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Instant;

use crate::tts_helper::{load_text_to_speech, load_voice_style, Style, TextToSpeech};

const SLICE_BYTES: usize = 8192; // 4096 int16 samples per emitted frame

pub enum SynthOutcome {
    Done { audio_s: f64, wall_ms: u64 },
    Cancelled,
}

pub struct Engine {
    tts: TextToSpeech,
    style: Style,
    cancelled: HashSet<u64>,
}

impl Engine {
    pub fn load(
        environment: &std::sync::Arc<ort::environment::Environment>,
        onnx_dir: &str,
        styles_dir: &str,
        voice: &str,
        intra_threads: usize,
    ) -> Result<Self> {
        let tts = load_text_to_speech(environment, onnx_dir, intra_threads)
            .context("supertonic-3 ONNX load failed")?;
        let style_path = format!("{styles_dir}/{voice}.json");
        let style = load_voice_style(&[style_path], false).context("voice style load failed")?;
        Ok(Self {
            tts,
            style,
            cancelled: HashSet::new(),
        })
    }

    pub fn sample_rate(&self) -> i32 {
        self.tts.sample_rate
    }

    pub fn cancel(&mut self, sid: u64) {
        self.cancelled.insert(sid);
    }

    /// Synthesize one utterance; emits PCM16 LE slices (base64 handled by caller
    /// so this stays a pure byte pump).
    pub fn synth(
        &mut self,
        sid: u64,
        text: &str,
        lang: &str,
        steps: usize,
        speed: f32,
        mut on_slice: impl FnMut(&[u8]),
    ) -> Result<SynthOutcome> {
        if self.cancelled.remove(&sid) {
            return Ok(SynthOutcome::Cancelled);
        }
        let t0 = Instant::now();
        let (wav, dur) = self
            .tts
            .call(text, lang, &self.style, steps, speed, 0.3)
            .context("supertonic synthesis failed")?;
        let audio_s = dur as f64;
        let mut pcm: Vec<u8> = Vec::with_capacity(wav.len() * 2);
        for &sample in &wav {
            let v = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
            pcm.extend_from_slice(&v.to_le_bytes());
        }
        for chunk in pcm.chunks(SLICE_BYTES) {
            if self.cancelled.contains(&sid) {
                self.cancelled.remove(&sid);
                return Ok(SynthOutcome::Cancelled);
            }
            on_slice(chunk);
        }
        self.cancelled.remove(&sid);
        Ok(SynthOutcome::Done {
            audio_s,
            wall_ms: t0.elapsed().as_millis() as u64,
        })
    }
}

/// Build the `tts.ready` event payload.
pub fn ready_payload(sample_rate: i32, voice: &str) -> Value {
    serde_json::json!({
        "event": "tts.ready",
        "sample_rate": sample_rate,
        "voice": voice,
    })
}
