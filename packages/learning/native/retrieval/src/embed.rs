//! Native ONNX inference for the distilled student query encoder — no Python at query time.
//!
//! Query-time embedding runs entirely in Rust:
//!   * the `tokenizers` crate loads the BGE-M3 tokenizer that `export.py` copies into the
//!     student runtime dir (`tokenizer.json`),
//!   * `ort` (ONNX Runtime, load-dynamic) executes the exported graph and returns
//!     `last_hidden_state [1, seq, 1024]`; the caller-visible vector is CLS pooling + L2
//!     normalisation — byte-for-byte what the app's TypeScript path produces.
//!
//! Device policy: register the CUDA execution provider when the onnxruntime installation
//! ships `libonnxruntime_providers_cuda.so` (ort falls back to CPU automatically if the
//! GPU path cannot be created at session time); otherwise CPU, preferring the INT8 graph
//! (fast VNNI kernels, 4x smaller). The dylib is located from `ORT_DYLIB_PATH`, the
//! binary's own directory, a pip user-install (`~/.local/lib/python3*/site-packages/
//! onnxruntime/capi`), or the usual system library dirs.

use std::env;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use ort::environment::Environment;
use ort::ep::{CPU, CUDA, ExecutionProviderDispatch};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;

pub const MAX_LEN: usize = 128;
pub const EXPECTED_DIM: usize = 1024;

static ENVIRONMENT: OnceLock<Result<std::sync::Arc<Environment>, String>> = OnceLock::new();
static DYLIB_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

pub struct StudentEmbedder {
    tokenizer: tokenizers::Tokenizer,
    session: Session,
    pub device: String,
    pub model_name: String,
}

/// Locate the onnxruntime shared library, highest-quality candidate first.
fn find_dylib() -> Option<PathBuf> {
    if let Some(cached) = DYLIB_PATH.get() {
        return cached.clone();
    }
    let found = find_dylib_uncached();
    let _ = DYLIB_PATH.set(found.clone());
    found
}

fn find_dylib_uncached() -> Option<PathBuf> {
    if let Ok(path) = env::var("ORT_DYLIB_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let mut search_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            search_dirs.push(dir.to_path_buf());
        }
    }
    if let Ok(home) = env::var("HOME") {
        let local = PathBuf::from(&home).join(".local").join("lib");
        if let Ok(entries) = std::fs::read_dir(&local) {
            for entry in entries.flatten() {
                let capi = entry.path().join("site-packages").join("onnxruntime").join("capi");
                if capi.is_dir() {
                    search_dirs.push(capi);
                }
            }
        }
    }
    search_dirs.push(PathBuf::from("/usr/local/lib"));
    search_dirs.push(PathBuf::from("/usr/lib/x86_64-linux-gnu"));
    search_dirs.push(PathBuf::from("/usr/lib"));

    let mut plain: Option<PathBuf> = None;
    let mut versioned: Vec<PathBuf> = Vec::new();
    let mut other: Vec<PathBuf> = Vec::new();
    for dir in search_dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if name == "libonnxruntime.so" || name == "libonnxruntime.dylib" || name == "onnxruntime.dll" {
                plain.get_or_insert(path);
            } else if name.starts_with("libonnxruntime.so.") || name.starts_with("libonnxruntime.") {
                versioned.push(path);
            } else if name.contains("onnxruntime") && (name.contains(".so") || name.contains(".dll") || name.contains(".dylib")) {
                other.push(path);
            }
        }
    }
    if plain.is_some() {
        return plain;
    }
    versioned.sort();
    if let Some(path) = versioned.pop() {
        return Some(path);
    }
    other.pop()
}

fn init_ort() -> Result<std::sync::Arc<Environment>, String> {
    if let Some(result) = ENVIRONMENT.get() {
        return result.clone();
    }
    let result = (|| {
        let dylib = find_dylib()
            .ok_or("no onnxruntime shared library found (set ORT_DYLIB_PATH or install onnxruntime)")?;
        let environment = ort::environment::init_from(&dylib)
            .map_err(|error| format!("cannot load onnxruntime from {}: {error}", dylib.display()))?
            .with_name("divee-retrieval")
            .build()
            .map_err(|error| format!("onnxruntime init failed: {error}"))?;
        Ok(std::sync::Arc::new(environment))
    })();
    let _ = ENVIRONMENT.set(result.clone());
    result
}

/// INT8 on CPU (fast, small); the fp32 graph when INT8 is absent. CUDA sessions run either
/// graph; dynamic-quantised ops fall back to CPU kernels inside ORT when unsupported.
fn pick_model(model_dir: &Path) -> Result<PathBuf, String> {
    for relative in [
        "onnx/model_int8.onnx",
        "model_int8.onnx",
        "onnx/model.onnx",
        "model.onnx",
    ] {
        let candidate = model_dir.join(relative);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "no onnx model (model.onnx / model_int8.onnx) under {}",
        model_dir.display()
    ))
}

fn has_cuda_provider() -> bool {
    find_dylib()
        .and_then(|dylib| dylib.parent().map(Path::to_path_buf))
        .is_some_and(|dir| {
            std::fs::read_dir(dir).is_ok_and(|entries| {
                entries.flatten().any(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    name.starts_with("libonnxruntime_providers_cuda") || name.starts_with("onnxruntime_providers_cuda")
                })
            })
        })
}

impl StudentEmbedder {
    /// Load the student runtime: tokenizer + ONNX graph. Every failure is a `String` the
    /// engine turns into a BM25-only fallback.
    pub fn load(model_dir: &Path) -> Result<StudentEmbedder, String> {
        let model_file = pick_model(model_dir)?;

        let tokenizer_path = [
            model_dir.join("tokenizer.json"),
            model_dir.join("tokenizer").join("tokenizer.json"),
        ]
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("no tokenizer.json under {}", model_dir.display()))?;
        let mut tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
            .map_err(|error| format!("cannot load tokenizer {}: {error}", tokenizer_path.display()))?;
        tokenizer
            .with_truncation(Some(tokenizers::TruncationParams {
                max_length: MAX_LEN,
                stride: 0,
                strategy: tokenizers::TruncationStrategy::LongestFirst,
                direction: tokenizers::TruncationDirection::Right,
            }))
            .map_err(|error| format!("cannot configure truncation: {error}"))?;

        let environment = init_ort()?;
        let cuda = has_cuda_provider();
        let mut providers: Vec<ExecutionProviderDispatch> = Vec::new();
        if cuda {
            providers.push(CUDA::default().build());
        }
        providers.push(CPU::default().build());

        let session = Session::builder(&environment)
            .map_err(|error| format!("cannot create session builder: {error}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|error| format!("cannot set optimization level: {error}"))?
            .with_execution_providers(&providers)
            .map_err(|error| format!("cannot set execution providers: {error}"))?
            .commit_from_file(&model_file)
            .map_err(|error| format!("cannot load onnx model {}: {error}", model_file.display()))?;

        Ok(StudentEmbedder {
            tokenizer,
            session,
            device: if cuda { "cuda".into() } else { "cpu".into() },
            model_name: model_file
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
        })
    }

    /// Encode one query: BGE-M3 tokenisation -> ONNX -> CLS pooling -> L2 normalisation.
    /// Output dim is always 1024 (the teacher space the vector index was built with).
    pub fn embed(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self
            .tokenizer
            .encode(text.to_string(), true)
            .map_err(|error| format!("tokenisation failed: {error}"))?;
        let ids: Vec<i64> = encoding.get_ids().iter().take(MAX_LEN).map(|&id| id as i64).collect();
        let mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .take(MAX_LEN)
            .map(|&value| value as i64)
            .collect();
        if ids.is_empty() {
            return Err("query produced no tokens".into());
        }
        let seq = ids.len();
        let ids_value = Tensor::from_array((vec![1i64, seq as i64], ids))
            .map_err(|error| format!("input_ids construction failed: {error}"))?;
        let mask_value = Tensor::from_array((vec![1i64, seq as i64], mask))
            .map_err(|error| format!("attention_mask construction failed: {error}"))?;
        let inputs = ort::inputs!["input_ids" => ids_value, "attention_mask" => mask_value];
        let outputs = self
            .session
            .run(inputs)
            .map_err(|error| format!("onnx inference failed: {error}"))?;
        let (shape, data) = outputs["last_hidden_state"]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("output extraction failed: {error}"))?;
        if data.len() < EXPECTED_DIM {
            return Err(format!(
                "unexpected output size {} (shape {:?}); expected at least {EXPECTED_DIM}",
                data.len(),
                shape
            ));
        }
        // CLS pooling: token position 0 of the (single) sequence.
        let cls = &data[..EXPECTED_DIM];
        let norm = cls.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm <= f32::EPSILON {
            return Err("degenerate embedding (zero norm)".into());
        }
        Ok(cls.iter().map(|x| x / norm).collect())
    }
}
