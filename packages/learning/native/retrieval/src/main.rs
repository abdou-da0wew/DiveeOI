mod metrics;

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env,
    ffi::{CStr, CString, c_char, c_double, c_int, c_void},
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    ptr,
    time::{Duration, Instant},
};

mod embed;

use embed::StudentEmbedder;

const SQLITE_OK: c_int = 0;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;
const OPEN_READONLY: c_int = 1;
const OPEN_READWRITE: c_int = 2;
const OPEN_NOMUTEX: c_int = 0x8000;
const OPEN_CREATE: c_int = 0x4;
const SQLITE_BLOB: c_int = 4;
const SQLITE_TRANSIENT: *const c_void = -1_isize as *const c_void;

#[repr(C)]
struct Sqlite3 {
    _private: [u8; 0],
}

#[repr(C)]
struct Sqlite3Stmt {
    _private: [u8; 0],
}

#[link(name = "libsqlite3.so.0", kind = "dylib", modifiers = "+verbatim")]
unsafe extern "C" {
    fn sqlite3_open_v2(
        filename: *const c_char,
        db: *mut *mut Sqlite3,
        flags: c_int,
        zvfs: *const c_char,
    ) -> c_int;
    fn sqlite3_close(db: *mut Sqlite3) -> c_int;
    fn sqlite3_errmsg(db: *mut Sqlite3) -> *const c_char;
    fn sqlite3_prepare_v2(
        db: *mut Sqlite3,
        sql: *const c_char,
        n: c_int,
        stmt: *mut *mut Sqlite3Stmt,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_bind_text(
        stmt: *mut Sqlite3Stmt,
        index: c_int,
        value: *const c_char,
        n: c_int,
        destructor: *const c_void,
    ) -> c_int;
    fn sqlite3_bind_int(stmt: *mut Sqlite3Stmt, index: c_int, value: c_int) -> c_int;
    fn sqlite3_step(stmt: *mut Sqlite3Stmt) -> c_int;
    fn sqlite3_reset(stmt: *mut Sqlite3Stmt) -> c_int;
    fn sqlite3_finalize(stmt: *mut Sqlite3Stmt) -> c_int;
    fn sqlite3_column_text(stmt: *mut Sqlite3Stmt, column: c_int) -> *const u8;
    fn sqlite3_column_int(stmt: *mut Sqlite3Stmt, column: c_int) -> c_int;
    fn sqlite3_column_double(stmt: *mut Sqlite3Stmt, column: c_int) -> c_double;
    fn sqlite3_busy_timeout(db: *mut Sqlite3, ms: c_int) -> c_int;
    fn sqlite3_column_blob(stmt: *mut Sqlite3Stmt, column: c_int) -> *const c_void;
    fn sqlite3_column_bytes(stmt: *mut Sqlite3Stmt, column: c_int) -> c_int;
    fn sqlite3_column_type(stmt: *mut Sqlite3Stmt, column: c_int) -> c_int;
    fn sqlite3_bind_blob(
        stmt: *mut Sqlite3Stmt,
        index: c_int,
        value: *const c_void,
        n: c_int,
        destructor: *const c_void,
    ) -> c_int;
    fn sqlite3_exec(
        db: *mut Sqlite3,
        sql: *const c_char,
        callback: *const c_void,
        arg: *mut c_void,
        errmsg: *mut *mut c_char,
    ) -> c_int;
}

#[derive(Serialize, Clone, Debug)]
struct Hit {
    chunk_id: String,
    book_id: String,
    section_id: String,
    page: Option<i64>,
    text: String,
    bm25_score: Option<f64>,
    dense_score: Option<f64>,
    fused_score: f64,
}

#[derive(Clone)]
struct Args {
    db: PathBuf,
    query: String,
    books: Vec<String>,
    /// Final number of fused hits returned.
    limit: usize,
    /// Lexical candidates kept before fusion.
    bm25_limit: usize,
    /// Dense candidates kept before fusion.
    dense_limit: usize,
    vector_base64: Option<String>,
    rrf_k: f64,
    bm25_weight: f64,
    dense_weight: f64,
    /// ONNX runtime dir of the distilled student encoder (the embedder sidecar's model).
    model_dir: Option<PathBuf>,
    /// Where the embedder sidecar script lives (default: sibling of this crate).
    embedder_script: Option<PathBuf>,
    /// Force BM25-only even when a student runtime is present.
    no_model: bool,
}

impl Args {
    fn defaults(db: PathBuf) -> Self {
        Self {
            db,
            query: String::new(),
            books: Vec::new(),
            limit: 8,
            bm25_limit: 30,
            dense_limit: 30,
            vector_base64: None,
            rrf_k: 60.0,
            bm25_weight: 1.0,
            dense_weight: 1.0,
            model_dir: None,
            embedder_script: None,
            no_model: false,
        }
    }

    fn validate(&self) -> Result<(), String> {
        if !self.rrf_k.is_finite() || self.rrf_k <= 0.0 {
            return Err("rrf_k must be a positive finite number".into());
        }
        if !self.bm25_weight.is_finite()
            || self.bm25_weight < 0.0
            || !self.dense_weight.is_finite()
            || self.dense_weight < 0.0
        {
            return Err("fusion weights must be finite and non-negative".into());
        }
        Ok(())
    }
}

enum Command {
    Search,
    Eval(PathBuf),
    Serve,
    Compact { drop_text: bool, vacuum: bool },
}

fn parse_args() -> Result<(Args, Command), String> {
    let mut it = env::args().skip(1);
    let mut db: Option<PathBuf> = None;
    let mut query: Option<String> = None;
    let mut eval: Option<PathBuf> = None;
    let mut books: Vec<String> = Vec::new();
    let mut vector_base64: Option<String> = None;
    let (mut limit, mut bm25_limit, mut dense_limit) = (8usize, 30usize, 30usize);
    let (mut rrf_k, mut bm25_weight, mut dense_weight) = (60.0f64, 1.0f64, 1.0f64);
    let (mut serve, mut compact) = (false, false);
    let (mut drop_text, mut vacuum) = (false, false);
    let mut model_dir: Option<PathBuf> = None;
    let mut embedder_script: Option<PathBuf> = None;
    let mut no_model = false;

    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--db" => db = it.next().map(PathBuf::from),
            "--query" => query = it.next(),
            "--book" => books.push(it.next().ok_or("--book requires an ID")?),
            "--limit" => limit = parse_usize(it.next(), "--limit")?,
            "--bm25-limit" => bm25_limit = parse_usize(it.next(), "--bm25-limit")?,
            "--dense-limit" => dense_limit = parse_usize(it.next(), "--dense-limit")?,
            "--vector-base64" => vector_base64 = it.next(),
            "--model-dir" => model_dir = it.next().map(PathBuf::from),
            "--embedder-script" => embedder_script = it.next().map(PathBuf::from),
            "--no-model" => no_model = true,
            "--eval" => eval = it.next().map(PathBuf::from),
            "--serve" => serve = true,
            "--compact" => compact = true,
            "--drop-text" => drop_text = true,
            "--vacuum" => vacuum = true,
            "--rrf-k" => rrf_k = parse_f64(it.next(), "--rrf-k")?,
            "--bm25-weight" => bm25_weight = parse_f64(it.next(), "--bm25-weight")?,
            "--dense-weight" => dense_weight = parse_f64(it.next(), "--dense-weight")?,
            "--help" | "-h" => {
                return Err(concat!(
                    "usage: divee-retrieval --db PATH --query TEXT --book ID [--book ID ...] ",
                    "[--vector-base64 BASE64] [--limit N] [--bm25-limit N] [--dense-limit N]\n",
                    "       [--model-dir DIR | --no-model] [--embedder-script PATH]\n",
                    "       divee-retrieval --db PATH --serve\n",
                    "       divee-retrieval --db PATH --compact [--drop-text] [--vacuum]\n",
                    "       divee-retrieval --db PATH --eval BENCH.jsonl [--book ID ...]\n\n",
                    "student encoder: when a student runtime dir is found (default ",
                    "$DIVEE_STUDENT_MODEL_DIR, else <repo>/../diveeoi-artifacts/models/student-runtime), ",
                    "plain-text queries are embedded by the distilled student (GPU when usable, CPU otherwise). ",
                    "If the sidecar is missing or errors, the engine falls back to BM25-only."
                )
                .into());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    let db = db.ok_or("--db is required")?;
    let mut args = Args::defaults(db);
    args.books = books;
    args.vector_base64 = vector_base64;
    args.limit = limit.clamp(1, 50);
    args.bm25_limit = bm25_limit.clamp(1, 200);
    args.dense_limit = dense_limit.clamp(1, 200);
    args.rrf_k = rrf_k;
    args.bm25_weight = bm25_weight;
    args.dense_weight = dense_weight;
    args.query = query.unwrap_or_default();
    args.model_dir = model_dir;
    args.embedder_script = embedder_script;
    args.no_model = no_model;
    args.validate()?;

    let command = if compact {
        Command::Compact { drop_text, vacuum }
    } else if serve {
        Command::Serve
    } else if let Some(path) = eval {
        Command::Eval(path)
    } else {
        if args.query.trim().is_empty() {
            return Err("--query is required".into());
        }
        Command::Search
    };
    if drop_text && !compact {
        return Err("--drop-text only applies to --compact".into());
    }
    Ok((args, command))
}

fn parse_usize(value: Option<String>, flag: &str) -> Result<usize, String> {
    value
        .ok_or_else(|| format!("{flag} requires a number"))?
        .parse()
        .map_err(|_| format!("invalid {flag}"))
}

fn parse_f64(value: Option<String>, flag: &str) -> Result<f64, String> {
    value
        .ok_or_else(|| format!("{flag} requires a number"))?
        .parse()
        .map_err(|_| format!("invalid {flag}"))
}

fn normalize(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        let cp = ch as u32;
        if (0x0610..=0x061A).contains(&cp)
            || (0x064B..=0x065F).contains(&cp)
            || cp == 0x0670
            || (0x06D6..=0x06ED).contains(&cp)
            || (0x08D3..=0x08FF).contains(&cp)
            || cp == 0x0640
        {
            continue;
        }
        let ch = match ch {
            'آ' | 'أ' | 'إ' | 'ٱ' | 'ٲ' | 'ٳ' | 'ٵ' => 'ا',
            'ى' => 'ي',
            'ة' => 'ه',
            _ => ch,
        };
        if ch.is_alphanumeric() || ch == '_' {
            out.push(ch);
        } else if !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Common function words, English + Arabic (in normalized form). FTS5 joins bare terms with an
/// implicit AND, so a single unmatched word ("determine" in a natural-language question) blanks
/// the whole lexical leg and the BM25 fallback loses its safety net. Stopwords are dropped and
/// the remaining terms are OR-joined; BM25 ranking still favours the rarer, meaningful ones.
const FTS_STOPWORDS: [&str; 54] = [
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in",
    "on", "for", "and", "or", "do", "does", "did", "how", "what", "when", "where", "which",
    "who", "why", "can", "could", "should", "would", "you", "your", "we", "they", "it", "its",
    "في", "من", "على", "الى", "الي", "عن", "هو", "هي", "ما", "هل", "كيف", "ماذا", "هذا", "هذه",
    "ان", "أن", "مع",
];

fn fts_expression(query: &str) -> String {
    normalize(query)
        .split_whitespace()
        .filter(|term| {
            !term.is_empty() && !FTS_STOPWORDS.contains(&term.to_lowercase().as_str())
        })
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut accumulator = 0u32;
    let mut bits = 0u8;

    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b' ' | b'\n' | b'\r' | b'\t' => continue,
            _ => return Err("invalid base64 vector".into()),
        } as u32;

        accumulator = (accumulator << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((accumulator >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

fn decode_vector(base64: &str) -> Result<Vec<f32>, String> {
    let bytes = decode_base64(base64)?;
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return Err("vector must contain a non-empty sequence of float32 values".into());
    }
    Ok(bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect())
}

fn cosine(a: &[f32], b: &[f32]) -> Option<f64> {
    if a.len() != b.len() || a.is_empty() {
        return None;
    }
    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;
    for (&x, &y) in a.iter().zip(b) {
        let x = x as f64;
        let y = y as f64;
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    let denominator = norm_a.sqrt() * norm_b.sqrt();
    if denominator <= f64::EPSILON {
        None
    } else {
        Some(dot / denominator)
    }
}

unsafe fn column_string(stmt: *mut Sqlite3Stmt, column: c_int) -> String {
    let p = unsafe { sqlite3_column_text(stmt, column) };
    if p.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(p as *const c_char) }
        .to_string_lossy()
        .into_owned()
}

fn bind_text(stmt: *mut Sqlite3Stmt, index: c_int, value: &str) -> Result<(), String> {
    let value = CString::new(value).map_err(|_| "text parameter contains NUL")?;
    let rc = unsafe { sqlite3_bind_text(stmt, index, value.as_ptr(), -1, SQLITE_TRANSIENT) };
    if rc != SQLITE_OK {
        return Err(format!("SQLite bind failed ({rc})"));
    }
    Ok(())
}

/// Runs a statement that returns no rows (DDL, bulk DELETE, VACUUM).
fn exec(db: *mut Sqlite3, sql: &str) -> Result<(), String> {
    let sql = CString::new(sql).map_err(|_| "invalid SQL")?;
    let rc = unsafe {
        sqlite3_exec(
            db,
            sql.as_ptr(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if rc != SQLITE_OK {
        return Err(sqlite_error(db, "execute"));
    }
    Ok(())
}

fn prepare(db: *mut Sqlite3, sql: &str, operation: &str) -> Result<*mut Sqlite3Stmt, String> {
    let sql = CString::new(sql).map_err(|_| "invalid SQL")?;
    let mut stmt: *mut Sqlite3Stmt = ptr::null_mut();
    let rc = unsafe { sqlite3_prepare_v2(db, sql.as_ptr(), -1, &mut stmt, ptr::null_mut()) };
    if rc != SQLITE_OK {
        return Err(sqlite_error(db, operation));
    }
    Ok(stmt)
}

fn column_blob(stmt: *mut Sqlite3Stmt, column: c_int) -> Option<Vec<u8>> {
    if unsafe { sqlite3_column_type(stmt, column) } != SQLITE_BLOB {
        return None;
    }
    let length = unsafe { sqlite3_column_bytes(stmt, column) };
    if length <= 0 {
        return None;
    }
    let data = unsafe { sqlite3_column_blob(stmt, column) } as *const u8;
    if data.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(data, length as usize) }.to_vec())
}

fn decode_blob(bytes: &[u8], expected_floats: usize) -> Option<Vec<f32>> {
    if bytes.is_empty() || !bytes.len().is_multiple_of(4) {
        return None;
    }
    if expected_floats > 0 && bytes.len() != expected_floats * 4 {
        return None;
    }
    Some(
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|chunk| f32::from_le_bytes(*chunk))
            .collect(),
    )
}

fn bind_blob(stmt: *mut Sqlite3Stmt, index: c_int, value: &[u8]) -> Result<(), String> {
    let rc = unsafe {
        sqlite3_bind_blob(
            stmt,
            index,
            value.as_ptr() as *const c_void,
            value.len() as c_int,
            SQLITE_TRANSIENT,
        )
    };
    if rc != SQLITE_OK {
        return Err(format!("SQLite bind failed ({rc})"));
    }
    Ok(())
}

/// True when `chunk_vecs_blob` exists, i.e. `--compact` has run at least once.
fn has_blob_table(db: *mut Sqlite3) -> bool {
    let Ok(stmt) = prepare(
        db,
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunk_vecs_blob'",
        "look for chunk_vecs_blob",
    ) else {
        return false;
    };
    let found = unsafe { sqlite3_step(stmt) } == SQLITE_ROW;
    unsafe {
        sqlite3_finalize(stmt);
    }
    found
}

fn sqlite_error(db: *mut Sqlite3, operation: &str) -> String {
    if db.is_null() {
        return format!("{operation}: SQLite database unavailable");
    }
    let message = unsafe { CStr::from_ptr(sqlite3_errmsg(db)) }.to_string_lossy();
    format!("{operation}: {message}")
}

fn open_db(path: &Path) -> Result<*mut Sqlite3, String> {
    open_db_with(path, true)
}

fn open_db_with(path: &Path, read_only: bool) -> Result<*mut Sqlite3, String> {
    let path =
        CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "invalid database path")?;
    let flags = if read_only {
        OPEN_READONLY | OPEN_NOMUTEX
    } else {
        // CREATE: fresh databases (test fixtures, first-time compaction targets) must be creatable;
        // existing files are unaffected.
        OPEN_READWRITE | OPEN_NOMUTEX | OPEN_CREATE
    };
    let mut db: *mut Sqlite3 = ptr::null_mut();
    let rc = unsafe { sqlite3_open_v2(path.as_ptr(), &mut db, flags, ptr::null()) };
    if rc != SQLITE_OK {
        let message = sqlite_error(db, "open database");
        if !db.is_null() {
            unsafe {
                sqlite3_close(db);
            }
        }
        return Err(message);
    }
    unsafe {
        sqlite3_busy_timeout(db, 2500);
    }
    Ok(db)
}

fn run_bm25(db: *mut Sqlite3, args: &Args, expression: &str) -> Result<Vec<Hit>, String> {
    if expression.is_empty() || args.books.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; args.books.len()].join(",");
    let sql = format!(
        "SELECT c.id,c.book_id,c.section_id,c.page,c.text,-bm25(chunks_fts) \
         FROM chunks_fts JOIN chunks c ON c.rowid=chunks_fts.rowid \
         WHERE chunks_fts MATCH ? AND c.book_id IN ({placeholders}) \
         ORDER BY bm25(chunks_fts) ASC LIMIT ?"
    );
    let sql = CString::new(sql).map_err(|_| "invalid SQL")?;
    let mut stmt: *mut Sqlite3Stmt = ptr::null_mut();
    let rc = unsafe { sqlite3_prepare_v2(db, sql.as_ptr(), -1, &mut stmt, ptr::null_mut()) };
    if rc != SQLITE_OK {
        return Err(sqlite_error(db, "prepare BM25 query"));
    }

    let bind_result = (|| {
        bind_text(stmt, 1, expression)?;
        for (i, book_id) in args.books.iter().enumerate() {
            bind_text(stmt, (i + 2) as c_int, book_id)?;
        }
        let rc = unsafe {
            sqlite3_bind_int(
                stmt,
                (args.books.len() + 2) as c_int,
                args.bm25_limit as c_int,
            )
        };
        if rc != SQLITE_OK {
            return Err(format!("SQLite bind limit failed ({rc})"));
        }
        Ok(())
    })();
    if let Err(error) = bind_result {
        unsafe {
            sqlite3_finalize(stmt);
        }
        return Err(error);
    }

    let mut hits = Vec::new();
    loop {
        match unsafe { sqlite3_step(stmt) } {
            SQLITE_ROW => {
                let page = unsafe { sqlite3_column_int(stmt, 3) };
                hits.push(Hit {
                    chunk_id: unsafe { column_string(stmt, 0) },
                    book_id: unsafe { column_string(stmt, 1) },
                    section_id: unsafe { column_string(stmt, 2) },
                    page: if page == 0 { None } else { Some(page as i64) },
                    text: unsafe { column_string(stmt, 4) },
                    bm25_score: Some(unsafe { sqlite3_column_double(stmt, 5) }),
                    dense_score: None,
                    fused_score: 0.0,
                });
            }
            SQLITE_DONE => break,
            _ => {
                let message = sqlite_error(db, "execute BM25 query");
                unsafe {
                    sqlite3_finalize(stmt);
                }
                return Err(message);
            }
        }
    }
    unsafe {
        sqlite3_finalize(stmt);
    }
    Ok(hits)
}

fn run_dense(db: *mut Sqlite3, args: &Args, query_vector: &[f32]) -> Result<Vec<Hit>, String> {
    if args.books.is_empty() || query_vector.is_empty() {
        return Ok(Vec::new());
    }

    // `chunk_vecs_blob` is optional (written by --compact). When it exists it is preferred: it
    // avoids base64 decode and halves the bytes read per vector.
    let placeholders = vec!["?"; args.books.len()].join(",");
    let sql = if has_blob_table(db) {
        format!(
            "SELECT c.id,c.book_id,c.section_id,c.page,c.text,v.vec,b.vec \
             FROM chunk_vecs v JOIN chunks c ON c.id=v.chunk_id \
             LEFT JOIN chunk_vecs_blob b ON b.chunk_id=c.id \
             WHERE c.book_id IN ({placeholders})"
        )
    } else {
        format!(
            "SELECT c.id,c.book_id,c.section_id,c.page,c.text,v.vec,NULL \
             FROM chunk_vecs v JOIN chunks c ON c.id=v.chunk_id \
             WHERE c.book_id IN ({placeholders})"
        )
    };
    let stmt = prepare(db, &sql, "prepare dense query")?;
    for (i, book_id) in args.books.iter().enumerate() {
        if let Err(error) = bind_text(stmt, (i + 1) as c_int, book_id) {
            unsafe {
                sqlite3_finalize(stmt);
            }
            return Err(error);
        }
    }

    // Keep only the best K results. Do not accumulate the entire corpus in RAM.
    let mut best: Vec<(f64, Hit)> = Vec::with_capacity(args.dense_limit);
    loop {
        match unsafe { sqlite3_step(stmt) } {
            SQLITE_ROW => {
                let vector = match column_blob(stmt, 6) {
                    Some(bytes) => decode_blob(&bytes, query_vector.len()),
                    None => match decode_base64(&unsafe { column_string(stmt, 5) }) {
                        Ok(bytes) => decode_blob(&bytes, query_vector.len()),
                        Err(_) => None,
                    },
                };
                let Some(vector) = vector else {
                    continue;
                };
                let Some(score) = cosine(query_vector, &vector) else {
                    continue;
                };
                // A zero or negative similarity is not a retrieval hit: keeping such rows
                // lets RRF hand a rank-1 fused score (1/(k+1) ≈ 0.0164) to a chunk with no
                // semantic relation to the query, which the gate's vectorless bar (0.014)
                // then accepts as "lexical evidence" that does not exist. Cross-lingual
                // misses (e.g. an Arabic question over an English book) hit exactly this.
                if score <= 0.0 {
                    continue;
                }

                if best.len() == args.dense_limit
                    && score <= best.last().map(|(s, _)| *s).unwrap_or(f64::NEG_INFINITY)
                {
                    continue;
                }

                let page = unsafe { sqlite3_column_int(stmt, 3) };
                let hit = Hit {
                    chunk_id: unsafe { column_string(stmt, 0) },
                    book_id: unsafe { column_string(stmt, 1) },
                    section_id: unsafe { column_string(stmt, 2) },
                    page: if page == 0 { None } else { Some(page as i64) },
                    text: unsafe { column_string(stmt, 4) },
                    bm25_score: None,
                    dense_score: Some(score),
                    fused_score: 0.0,
                };

                if best.len() == args.dense_limit {
                    best.pop();
                }
                let insert_at = best
                    .iter()
                    .position(|(existing, _)| score > *existing)
                    .unwrap_or(best.len());
                best.insert(insert_at, (score, hit));
            }
            SQLITE_DONE => break,
            _ => {
                let message = sqlite_error(db, "execute dense query");
                unsafe {
                    sqlite3_finalize(stmt);
                }
                return Err(message);
            }
        }
    }
    unsafe {
        sqlite3_finalize(stmt);
    }
    Ok(best.into_iter().map(|(_, hit)| hit).collect())
}

fn fuse(args: &Args, bm25: Vec<Hit>, dense: Vec<Hit>) -> (Vec<Hit>, f64) {
    let mut merged: HashMap<String, Hit> = HashMap::new();

    for (rank, hit) in bm25.into_iter().enumerate() {
        let id = hit.chunk_id.clone();
        let entry = merged.entry(id).or_insert(hit);
        entry.fused_score += args.bm25_weight / (args.rrf_k + rank as f64 + 1.0);
    }

    for (rank, hit) in dense.into_iter().enumerate() {
        let id = hit.chunk_id.clone();
        let entry = merged.entry(id).or_insert_with(|| hit.clone());
        if let Some(score) = hit.dense_score {
            entry.dense_score = Some(score);
        }
        entry.fused_score += args.dense_weight / (args.rrf_k + rank as f64 + 1.0);
    }

    let mut results: Vec<Hit> = merged.into_values().collect();
    results.sort_by(|a, b| b.fused_score.total_cmp(&a.fused_score));
    let best_fused = results.first().map(|hit| hit.fused_score).unwrap_or(0.0);
    results.truncate(args.limit);
    (results, best_fused)
}

fn search_db(db: *mut Sqlite3, args: &Args) -> Result<(Vec<Hit>, f64, f64), String> {
    let expression = fts_expression(&args.query);
    let lexical = run_bm25(db, args, &expression)?;
    let dense = match &args.vector_base64 {
        Some(encoded) => {
            let vector = decode_vector(encoded)?;
            run_dense(db, args, &vector)?
        }
        None => Vec::new(),
    };
    let best_dense = dense
        .iter()
        .filter_map(|hit| hit.dense_score)
        .fold(0.0f64, f64::max);
    let (hits, best_fused) = fuse(args, lexical, dense);
    Ok((hits, best_dense, best_fused))
}

fn search(args: &Args) -> Result<Vec<Hit>, String> {
    let db = open_db(&args.db)?;
    let result = search_db(db, args).map(|(hits, _, _)| hits);
    unsafe {
        sqlite3_close(db);
    }
    result
}

/// TEXT -> `chunk_vecs_blob`. Additive by default: the legacy column is only emptied with
/// `--drop-text`, so older builds keep working until every instance runs this binary.
fn compact(args: &Args, drop_text: bool, vacuum: bool) -> Result<String, String> {
    let db = open_db_with(&args.db, false)?;
    let outcome = (|| {
        exec(
            db,
            "CREATE TABLE IF NOT EXISTS chunk_vecs_blob (chunk_id TEXT PRIMARY KEY, vec BLOB NOT NULL)",
        )?;
        // Orphans come from books re-ingested or removed after the last compaction.
        exec(
            db,
            "DELETE FROM chunk_vecs_blob WHERE chunk_id NOT IN (SELECT chunk_id FROM chunk_vecs)",
        )?;

        let read = prepare(
            db,
            "SELECT v.chunk_id, v.vec FROM chunk_vecs v \
             LEFT JOIN chunk_vecs_blob b ON b.chunk_id = v.chunk_id \
             WHERE b.chunk_id IS NULL AND v.vec <> ''",
            "prepare compaction scan",
        )?;
        let write = prepare(
            db,
            "INSERT OR REPLACE INTO chunk_vecs_blob (chunk_id, vec) VALUES (?, ?)",
            "prepare compaction write",
        )?;

        let (mut compacted, mut skipped) = (0u64, 0u64);
        loop {
            match unsafe { sqlite3_step(read) } {
                SQLITE_ROW => {
                    let chunk_id = unsafe { column_string(read, 0) };
                    let bytes = match decode_base64(&unsafe { column_string(read, 1) }) {
                        Ok(bytes) if !bytes.is_empty() && bytes.len() % 4 == 0 => bytes,
                        _ => {
                            skipped += 1;
                            continue;
                        }
                    };
                    let bound = bind_text(write, 1, &chunk_id)
                        .and_then(|()| bind_blob(write, 2, &bytes))
                        .and_then(|()| {
                            let rc = unsafe { sqlite3_step(write) };
                            let reset = unsafe { sqlite3_reset(write) };
                            if rc == SQLITE_DONE && reset == SQLITE_OK {
                                Ok(())
                            } else {
                                Err(sqlite_error(db, "write blob vector"))
                            }
                        });
                    match bound {
                        Ok(()) => compacted += 1,
                        Err(error) => {
                            unsafe {
                                sqlite3_finalize(read);
                                sqlite3_finalize(write);
                            }
                            return Err(error);
                        }
                    }
                }
                SQLITE_DONE => break,
                _ => {
                    let message = sqlite_error(db, "scan chunk_vecs");
                    unsafe {
                        sqlite3_finalize(read);
                        sqlite3_finalize(write);
                    }
                    return Err(message);
                }
            }
        }
        unsafe {
            sqlite3_finalize(read);
            sqlite3_finalize(write);
        }

        let remaining = count(
            db,
            "SELECT COUNT(*) FROM chunk_vecs WHERE vec <> ''",
            "count remaining TEXT vectors",
        )?;
        if drop_text {
            exec(
                db,
                "UPDATE chunk_vecs SET vec = '' WHERE chunk_id IN (SELECT chunk_id FROM chunk_vecs_blob)",
            )?;
        }
        let dropped = if drop_text {
            count(
                db,
                "SELECT COUNT(*) FROM chunk_vecs WHERE vec = ''",
                "count dropped",
            )?
        } else {
            0
        };
        if vacuum {
            exec(db, "VACUUM")?;
        }
        Ok(serde_json::json!({
            "compacted": compacted,
            "skipped": skipped,
            "text_vectors_remaining": if drop_text { 0 } else { remaining },
            "dropped_text": drop_text,
            "dropped_rows": dropped,
            "blob_vectors": count(db, "SELECT COUNT(*) FROM chunk_vecs_blob", "count blobs")?,
            "vacuumed": vacuum,
        })
        .to_string())
    })();
    unsafe {
        sqlite3_close(db);
    }
    outcome
}

fn count(db: *mut Sqlite3, sql: &str, operation: &str) -> Result<u64, String> {
    let stmt = prepare(db, sql, operation)?;
    let value = if unsafe { sqlite3_step(stmt) } == SQLITE_ROW {
        unsafe { sqlite3_column_int(stmt, 0) }.max(0) as u64
    } else {
        0
    };
    unsafe {
        sqlite3_finalize(stmt);
    }
    Ok(value)
}

#[derive(Deserialize)]
struct ServeRequest {
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    query: String,
    #[serde(default)]
    books: Vec<String>,
    #[serde(default)]
    vector_base64: Option<String>,
    #[serde(default = "default_limit")]
    limit: usize,
    #[serde(default = "default_candidates")]
    bm25_limit: usize,
    #[serde(default = "default_candidates")]
    dense_limit: usize,
    #[serde(default = "default_rrf_k")]
    rrf_k: f64,
    #[serde(default = "default_weight")]
    bm25_weight: f64,
    #[serde(default = "default_weight")]
    dense_weight: f64,
}

fn default_limit() -> usize {
    8
}
fn default_candidates() -> usize {
    30
}
fn default_rrf_k() -> f64 {
    60.0
}
fn default_weight() -> f64 {
    1.0
}

/// Student-embedder configuration.
///
/// Policy: the distilled student is the primary query encoder and inference runs natively
/// in Rust (see `embed.rs` — ort + tokenizers, no Python). When a runtime dir exists
/// (flag > $DIVEE_STUDENT_MODEL_DIR > the default artifacts location) the engine loads it
/// on first use; CUDA execution provider when the onnxruntime install ships one, CPU INT8
/// otherwise. Any load or embed failure degrades the engine to BM25-only search — the
/// classic "rust only with no models" mode — and the load is retried after a cooldown.
struct EmbedderConfig {
    disabled: bool,
    disabled_reason: &'static str,
    model_dir: Option<PathBuf>,
    retry_cooldown: Duration,
}

impl EmbedderConfig {
    fn disabled(reason: &'static str) -> Self {
        Self {
            disabled: true,
            disabled_reason: reason,
            model_dir: None,
            retry_cooldown: Duration::from_secs(60),
        }
    }

    fn resolve(args: &Args) -> Self {
        if args.no_model {
            return Self::disabled("--no-model requested");
        }
        let model_dir = args
            .model_dir
            .clone()
            .or_else(|| env::var("DIVEE_STUDENT_MODEL_DIR").ok().map(PathBuf::from))
            .or_else(default_model_dir);
        let Some(model_dir) = model_dir.filter(|dir| dir.is_dir()) else {
            return Self::disabled("no student runtime dir found");
        };
        Self {
            disabled: false,
            disabled_reason: "",
            model_dir: Some(model_dir),
            retry_cooldown: Duration::from_secs(60),
        }
    }
}

/// Default artifacts dir: a `diveeoi-artifacts/models/student-runtime` sibling of the repo.
/// exe at <repo>/packages/learning/native/retrieval/target/release/...
fn default_model_dir() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    let repo = exe.parent()?.ancestors().nth(6)?;
    let candidate = repo
        .parent()?
        .join("diveeoi-artifacts")
        .join("models")
        .join("student-runtime");
    candidate.is_dir().then_some(candidate)
}

const BASE64_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let packed = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(BASE64_ALPHABET[(packed >> 18) as usize & 63] as char);
        out.push(BASE64_ALPHABET[(packed >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            BASE64_ALPHABET[(packed >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_ALPHABET[packed as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn encode_vector(values: &[f32]) -> String {
    encode_base64(
        &values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect::<Vec<u8>>(),
    )
}

/// Fills `args.vector_base64` for plain-text queries and returns the encoder metadata that
/// every response carries. Priority: caller-supplied vector > student model > BM25-only.
fn attach_vector(
    args: &mut Args,
    embedder: &mut Option<StudentEmbedder>,
    cfg: &EmbedderConfig,
    degraded_since: &mut Option<Instant>,
) -> serde_json::Value {
    if args.vector_base64.is_some() {
        return serde_json::json!({ "encoder": "caller" });
    }
    if cfg.disabled {
        return serde_json::json!({
            "encoder": "none",
            "fallback": true,
            "reason": cfg.disabled_reason,
        });
    }
    if embedder.is_none() {
        let cooldown_over = degraded_since
            .map(|started| started.elapsed() >= cfg.retry_cooldown)
            .unwrap_or(true);
        if !cooldown_over {
            return serde_json::json!({
                "encoder": "none",
                "fallback": true,
                "reason": "student model degraded, retry cooldown active",
            });
        }
        let Some(model_dir) = cfg.model_dir.clone() else {
            return serde_json::json!({ "encoder": "none", "fallback": true });
        };
        match StudentEmbedder::load(&model_dir) {
            Ok(loaded) => {
                eprintln!(
                    "student encoder loaded: dir={} model={} device={}",
                    model_dir.display(),
                    loaded.model_name,
                    loaded.device
                );
                *embedder = Some(loaded);
                *degraded_since = None;
            }
            Err(error) => {
                *degraded_since = Some(Instant::now());
                return serde_json::json!({
                    "encoder": "none",
                    "fallback": true,
                    "embedder_error": error,
                });
            }
        }
    }
    let Some(active) = embedder.as_mut() else {
        return serde_json::json!({ "encoder": "none", "fallback": true });
    };
    let started = Instant::now();
    match active.embed(&args.query) {
        Ok(vector) => {
            args.vector_base64 = Some(encode_vector(&vector));
            serde_json::json!({
                "encoder": "student",
                "device": active.device,
                "embed_model": active.model_name,
                "embed_ms": round_ms(started.elapsed()),
            })
        }
        Err(error) => {
            // The model is errored (or the query cannot be encoded): fall back now, retry later.
            *degraded_since = Some(Instant::now());
            *embedder = None;
            serde_json::json!({
                "encoder": "none",
                "fallback": true,
                "embedder_error": error,
            })
        }
    }
}

fn round_ms(elapsed: Duration) -> f64 {
    (elapsed.as_secs_f64() * 1000.0 * 1000.0).round() / 1000.0
}

/// Terminal failures reach a chat user, so every error response carries a clean human-readable
/// message (English + Arabic) next to the technical detail — never a raw driver error alone.
/// The engine keeps running: an error response answers one request, it does not stop the loop.
fn friendly_error(kind: &str, detail: &str) -> serde_json::Value {
    let (en, ar) = match kind {
        "index_unavailable" => (
            "The book search index is unavailable right now. Please try again in a moment.",
            "فهرس البحث في الكتب غير متاح حاليًا. حاول مرة أخرى بعد قليل.",
        ),
        "bad_request" => (
            "The search request was invalid.",
            "طلب البحث غير صالح.",
        ),
        _ => (
            "The book search could not be completed. Please try again in a moment.",
            "تعذّر إكمال البحث في الكتب. حاول مرة أخرى بعد قليل.",
        ),
    };
    serde_json::json!({
        "error": en,
        "error_ar": ar,
        "error_kind": kind,
        "friendly": true,
        "detail": detail,
    })
}

/// Bucket a raw engine error for `friendly_error`. Index-level problems (SQLite/FTS) get the
/// dedicated outage message; everything else stays generic.
fn classify_search_error(detail: &str) -> &'static str {
    let lower = detail.to_lowercase();
    if lower.contains("sqlite")
        || lower.contains("no such table")
        || lower.contains("unable to open")
        || lower.contains("database")
        || lower.contains("disk image")
        || lower.contains("malformed")
        || lower.contains("fts")
    {
        "index_unavailable"
    } else {
        "search_failed"
    }
}

/// One NDJSON request -> one NDJSON response. Never panics on bad input: the caller is a
/// long-lived chat process and a malformed line must not take the engine down.
fn handle_line(db: *mut Sqlite3, line: &str, embedder: &mut Option<StudentEmbedder>, cfg: &EmbedderConfig, degraded_since: &mut Option<Instant>) -> String {
    let request: ServeRequest = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            let mut payload = friendly_error("bad_request", &format!("invalid request: {error}"));
            payload["id"] = serde_json::Value::Null;
            return payload.to_string();
        }
    };
    let mut args = Args::defaults(PathBuf::new());
    args.query = request.query;
    args.books = request.books;
    args.vector_base64 = request.vector_base64;
    args.limit = request.limit.clamp(1, 50);
    args.bm25_limit = request.bm25_limit.clamp(1, 200);
    args.dense_limit = request.dense_limit.clamp(1, 200);
    args.rrf_k = request.rrf_k;
    args.bm25_weight = request.bm25_weight;
    args.dense_weight = request.dense_weight;

    let started = Instant::now();
    if let Err(error) = args.validate() {
        let mut payload = friendly_error("bad_request", &error);
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("id".into(), serde_json::json!(request.id));
        }
        return payload.to_string();
    }
    let encoder_meta = attach_vector(&mut args, embedder, cfg, degraded_since);
    match search_db(db, &args) {
        Ok((hits, best_dense, best_fused)) => {
            let mut response = serde_json::json!({
                "id": request.id,
                "hits": hits,
                "best_dense_score": best_dense,
                "best_fused_score": best_fused,
                "elapsed_ms": started.elapsed().as_secs_f64() * 1000.0,
            });
            if let (serde_json::Value::Object(meta), Some(target)) = (&encoder_meta, response.as_object_mut()) {
                for (key, value) in meta {
                    target.insert(key.clone(), value.clone());
                }
            }
            response.to_string()
        }
        Err(error) => {
            let kind = classify_search_error(&error);
            eprintln!("search failed ({}): {error}", kind);
            let mut payload = friendly_error(kind, &error);
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("id".into(), serde_json::json!(request.id));
            }
            payload.to_string()
        }
    }
}

/// Reads NDJSON requests from stdin until EOF, keeping one read-only database handle open.
/// The student encoder is loaded once, shared across requests, and self-heals after failures.
fn serve(args: &Args) -> Result<(), String> {
    let db = open_db(&args.db)?;
    let cfg = EmbedderConfig::resolve(args);
    if cfg.disabled {
        eprintln!("student encoder disabled ({}); BM25-only fallback", cfg.disabled_reason);
    } else if let Some(dir) = &cfg.model_dir {
        eprintln!(
            "student encoder enabled (dir={}); CUDA when usable, CPU INT8 otherwise",
            dir.display()
        );
    }
    let mut embedder: Option<StudentEmbedder> = None;
    let mut degraded_since: Option<Instant> = None;
    let stdin = io::stdin();
    let stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = handle_line(db, line.trim(), &mut embedder, &cfg, &mut degraded_since);
        let mut out = stdout.lock();
        if writeln!(out, "{response}").is_err() || out.flush().is_err() {
            break;
        }
    }
    unsafe {
        sqlite3_close(db);
    }
    Ok(())
}

/// One judged query. `vector_base64` is that encoder's query vector (teacher or student), so the
/// same benchmark file is run once per encoder and the reports are compared.
#[derive(Deserialize)]
struct EvalCase {
    query: String,
    #[serde(default)]
    vector_base64: Option<String>,
    relevant: Vec<String>,
    /// Slice label, e.g. "ar", "en", "ar-en", "en-ar", "synonym", "typo".
    #[serde(default)]
    tag: Option<String>,
}

#[derive(Default, Serialize)]
struct Slice {
    queries: usize,
    recall_at_5: f64,
    recall_at_10: f64,
    mrr_at_10: f64,
    ndcg_at_10: f64,
}

#[derive(Serialize)]
struct EvalReport {
    mode: &'static str,
    overall: Slice,
    by_tag: BTreeMap<String, Slice>,
    latency_ms_p50: f64,
    latency_ms_p95: f64,
    failed_queries: usize,
}

fn accumulate(slice: &mut Slice, ranked: &[String], relevant: &HashSet<String>) {
    slice.queries += 1;
    slice.recall_at_5 += metrics::recall_at(ranked, relevant, 5);
    slice.recall_at_10 += metrics::recall_at(ranked, relevant, 10);
    slice.mrr_at_10 += metrics::reciprocal_rank_at(ranked, relevant, 10);
    slice.ndcg_at_10 += metrics::ndcg_at(ranked, relevant, 10);
}

fn finish(slice: &mut Slice) {
    if slice.queries == 0 {
        return;
    }
    let n = slice.queries as f64;
    slice.recall_at_5 /= n;
    slice.recall_at_10 /= n;
    slice.mrr_at_10 /= n;
    slice.ndcg_at_10 /= n;
}

fn run_eval(args: &Args, path: &Path) -> Result<EvalReport, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let db = open_db(&args.db)?;
    let mut overall = Slice::default();
    let mut by_tag: BTreeMap<String, Slice> = BTreeMap::new();
    let mut latencies = Vec::new();
    let (mut failed, mut dense_cases) = (0usize, 0usize);
    let mut outcome = Ok(());
    for (number, line) in text
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
    {
        let case: EvalCase = match serde_json::from_str(line) {
            Ok(case) => case,
            Err(e) => {
                outcome = Err(format!("{}:{}: {e}", path.display(), number + 1));
                break;
            }
        };
        let mut case_args = args.clone();
        case_args.query = case.query;
        case_args.limit = args.limit.max(10);
        dense_cases += usize::from(case.vector_base64.is_some());
        case_args.vector_base64 = case.vector_base64;
        let started = Instant::now();
        let hits = match search_db(db, &case_args) {
            Ok((hits, _, _)) => hits,
            Err(_) => {
                failed += 1;
                Vec::new()
            }
        };
        latencies.push(started.elapsed().as_secs_f64() * 1000.0);
        let ranked: Vec<String> = hits.into_iter().map(|hit| hit.chunk_id).collect();
        let relevant: HashSet<String> = case.relevant.into_iter().collect();
        accumulate(&mut overall, &ranked, &relevant);
        if let Some(tag) = case.tag {
            accumulate(by_tag.entry(tag).or_default(), &ranked, &relevant);
        }
    }
    unsafe {
        sqlite3_close(db);
    }
    outcome?;
    finish(&mut overall);
    by_tag.values_mut().for_each(finish);
    Ok(EvalReport {
        mode: if dense_cases == 0 {
            "bm25-only"
        } else {
            "hybrid"
        },
        overall,
        by_tag,
        latency_ms_p50: metrics::percentile(&latencies, 50.0),
        latency_ms_p95: metrics::percentile(&latencies, 95.0),
        failed_queries: failed,
    })
}

fn main() {
    let outcome: Result<String, String> = (|| {
        let (mut args, command) = parse_args()?;
        Ok(match command {
            Command::Compact { drop_text, vacuum } => compact(&args, drop_text, vacuum)?,
            Command::Serve => {
                serve(&args)?;
                String::new()
            }
            Command::Eval(path) => serde_json::to_string(&run_eval(&args, &path)?)
                .map_err(|error| error.to_string())?,
            Command::Search => {
                let mut embedder: Option<StudentEmbedder> = None;
                let mut degraded_since: Option<Instant> = None;
                let cfg = EmbedderConfig::resolve(&args);
                let meta = attach_vector(&mut args, &mut embedder, &cfg, &mut degraded_since);
                let hits = search(&args)?;
                let mut response = serde_json::json!({ "hits": hits });
                if let (serde_json::Value::Object(meta), Some(target)) = (&meta, response.as_object_mut()) {
                    for (key, value) in meta {
                        target.insert(key.clone(), value.clone());
                    }
                }
                serde_json::to_string(&response).map_err(|error| error.to_string())?
            }
        })
    })();
    match outcome {
        Ok(json) => {
            if !json.is_empty() {
                println!("{json}");
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    fn encode_base64(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let packed = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(ALPHABET[(packed >> 18) as usize & 63] as char);
            out.push(ALPHABET[(packed >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 {
                ALPHABET[(packed >> 6) as usize & 63] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                ALPHABET[packed as usize & 63] as char
            } else {
                '='
            });
        }
        out
    }

    fn encode_vector(values: &[f32]) -> String {
        encode_base64(
            &values
                .iter()
                .flat_map(|v| v.to_le_bytes())
                .collect::<Vec<u8>>(),
        )
    }

    struct Fixture {
        path: PathBuf,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = env::temp_dir().join(format!(
                "divee-retrieval-{name}-{}-{nanos}.db",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&path);
            let db = open_db_with(&path, false).expect("create fixture");

            for sql in [
                "CREATE TABLE chunks (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, section_id TEXT NOT NULL, \
                 ord INTEGER, page INTEGER, text TEXT, text_norm TEXT, token_count INTEGER)",
                "CREATE VIRTUAL TABLE chunks_fts USING fts5(text_norm, content='chunks', \
                 content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')",
                "CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN \
                 INSERT INTO chunks_fts(rowid, text_norm) VALUES (new.rowid, new.text_norm); END",
                "CREATE TABLE chunk_vecs (chunk_id TEXT PRIMARY KEY, vec TEXT NOT NULL)",
            ] {
                exec(db, sql).expect("schema");
            }

            let chunks = prepare(
                db,
                "INSERT INTO chunks (id, book_id, section_id, ord, page, text, text_norm, token_count) \
                 VALUES (?, 'book', 'sec', 0, 1, ?, ?, 5)",
                "insert chunk",
            )
            .expect("prepare chunk insert");
            let vectors = prepare(
                db,
                "INSERT INTO chunk_vecs (chunk_id, vec) VALUES (?, ?)",
                "insert vector",
            )
            .expect("prepare vector insert");

            for (id, text, vector) in [
                ("a", "the heart has four chambers", [1.0f32, 0.0, 0.0]),
                ("b", "the lungs exchange oxygen", [0.0, 1.0, 0.0]),
                ("c", "kidneys filter the blood", [0.0, 0.0, 1.0]),
            ] {
                bind_text(chunks, 1, id).unwrap();
                bind_text(chunks, 2, text).unwrap();
                bind_text(chunks, 3, text).unwrap();
                assert_eq!(unsafe { sqlite3_step(chunks) }, SQLITE_DONE);
                assert_eq!(unsafe { sqlite3_reset(chunks) }, SQLITE_OK);

                bind_text(vectors, 1, id).unwrap();
                bind_text(vectors, 2, &encode_vector(&vector)).unwrap();
                assert_eq!(unsafe { sqlite3_step(vectors) }, SQLITE_DONE);
                assert_eq!(unsafe { sqlite3_reset(vectors) }, SQLITE_OK);
            }

            unsafe {
                sqlite3_finalize(chunks);
                sqlite3_finalize(vectors);
                sqlite3_close(db);
            }
            Self { path }
        }

        fn args(&self, query: &str) -> Args {
            let mut args = Args::defaults(self.path.clone());
            args.query = query.to_string();
            args.books = vec!["book".into()];
            args.limit = 3;
            args
        }

        fn search(&self, query: &str, vector: Option<&[f32]>) -> (Vec<Hit>, f64, f64) {
            let mut args = self.args(query);
            args.vector_base64 = vector.map(encode_vector);
            let db = open_db(&self.path).expect("open fixture");
            let result = search_db(db, &args);
            unsafe {
                sqlite3_close(db);
            }
            result.expect("search")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
            let _ = std::fs::remove_file(self.path.with_extension("db-wal"));
            let _ = std::fs::remove_file(self.path.with_extension("db-shm"));
        }
    }

    #[test]
    fn bm25_and_dense_both_reach_fusion() {
        let fixture = Fixture::new("fusion");
        let (hits, best_dense, best_fused) =
            fixture.search("heart chambers", Some(&[1.0, 0.0, 0.0]));
        assert_eq!(hits.first().map(|hit| hit.chunk_id.as_str()), Some("a"));
        assert!(best_dense > 0.99, "{best_dense}");
        assert!(best_fused > 0.0);
        let top = hits.first().unwrap();
        assert!(top.bm25_score.is_some());
        assert!(top.dense_score.is_some());
    }

    #[test]
    fn dense_only_query_finds_a_paraphrase() {
        let fixture = Fixture::new("dense-only");
        // No lexical overlap at all: only the vector can find the lung chunk.
        let (hits, _, _) = fixture.search("zzz", Some(&[0.0, 1.0, 0.0]));
        assert_eq!(hits.first().map(|hit| hit.chunk_id.as_str()), Some("b"));
        assert!(hits.first().is_some_and(|hit| hit.bm25_score.is_none()));
    }

    #[test]
    fn compaction_is_additive_and_idempotent() {
        let fixture = Fixture::new("compact");
        let args = fixture.args("");

        let first = compact(&args, false, false).expect("compact");
        assert!(first.contains("\"compacted\":3"), "{first}");
        assert!(first.contains("\"text_vectors_remaining\":3"), "{first}");

        let second = compact(&args, false, false).expect("compact twice");
        assert!(second.contains("\"compacted\":0"), "{second}");

        // With TEXT emptied, the dense path must still work from the blob table.
        let db = open_db_with(&fixture.path, false).expect("open");
        exec(db, "UPDATE chunk_vecs SET vec = ''").expect("empty text vectors");
        unsafe {
            sqlite3_close(db);
        }
        let (hits, best_dense, _) = fixture.search("zzz", Some(&[0.0, 0.0, 1.0]));
        assert_eq!(hits.first().map(|hit| hit.chunk_id.as_str()), Some("c"));
        assert!(best_dense > 0.99, "{best_dense}");
    }

    #[test]
    fn serve_mode_answers_ndjson_requests() {
        let fixture = Fixture::new("serve");
        let db = open_db(&fixture.path).expect("open");
        let request = format!(
            "{{\"id\":7,\"query\":\"heart chambers\",\"books\":[\"book\"],\"vector_base64\":\"{}\",\"limit\":1}}",
            encode_vector(&[1.0, 0.0, 0.0])
        );
        let response: serde_json::Value =
            serde_json::from_str(&handle_line(db, &request, &mut None, &EmbedderConfig::disabled("test"), &mut None))
                .expect("json response");
        let malformed: serde_json::Value =
            serde_json::from_str(&handle_line(db, "not json", &mut None, &EmbedderConfig::disabled("test"), &mut None))
                .expect("json error");
        unsafe {
            sqlite3_close(db);
        }

        assert_eq!(response["id"], 7);
        assert_eq!(response["hits"].as_array().map(|hits| hits.len()), Some(1));
        assert_eq!(response["hits"][0]["chunk_id"], "a");
        assert!(response["best_dense_score"].as_f64().unwrap_or(0.0) > 0.99);
        assert!(malformed.get("error").is_some());
    }

    #[test]
    fn bm25_fallback_when_no_model_is_available() {
        let fixture = Fixture::new("fallback");
        let db = open_db(&fixture.path).expect("open");
        // Plain-text query, embedder disabled (no student runtime): the engine must still
        // answer — BM25-only, clearly flagged as a fallback with encoder "none".
        let response: serde_json::Value = serde_json::from_str(&handle_line(
            db,
            r#"{"id":9,"query":"heart chambers","books":["book"],"limit":5}"#,
            &mut None,
            &EmbedderConfig::disabled("no student runtime dir found"),
            &mut None,
        ))
        .expect("json response");
        unsafe {
            sqlite3_close(db);
        }

        assert_eq!(response["encoder"], "none");
        assert_eq!(response["fallback"], true);
        assert_eq!(response["reason"], "no student runtime dir found");
        assert!(response["best_dense_score"].as_f64().unwrap_or(-1.0) == 0.0);
        let hits = response["hits"].as_array().expect("hits array");
        assert!(!hits.is_empty(), "bm25-only must still return hits");
        assert!(hits.iter().any(|hit| hit["chunk_id"] == "a"));
    }

    #[test]
    fn errors_are_friendly_and_carry_both_languages() {
        let fixture = Fixture::new("friendly");
        let db = open_db(&fixture.path).expect("open");
        // A config-level error (bad rrf_k) must come back as a clean, bilingual, machine-tagged
        // message — not a bare driver string.
        let response: serde_json::Value = serde_json::from_str(&handle_line(
            db,
            r#"{"id":3,"query":"heart","books":["book"],"rrf_k":-1}"#,
            &mut None,
            &EmbedderConfig::disabled("test"),
            &mut None,
        ))
        .expect("json error response");
        let malformed: serde_json::Value = serde_json::from_str(
            &handle_line(db, "}}not json{{", &mut None, &EmbedderConfig::disabled("test"), &mut None),
        )
        .expect("json error response");
        unsafe {
            sqlite3_close(db);
        }

        for payload in [&response, &malformed] {
            assert_eq!(payload["friendly"], true, "errors must be tagged friendly");
            assert!(payload["error_kind"].is_string(), "error_kind required");
            assert!(payload["error_ar"].is_string(), "arabic message required");
            let message = payload["error"].as_str().unwrap_or_default();
            assert!(!message.contains("sqlite"), "raw driver text must not lead the message");
        }
        assert_eq!(response["error_kind"], "bad_request");
        assert_eq!(response["id"], 3);
    }

    #[test]
    fn arabic_normalization_handles_diacritics_and_letters() {
        assert_eq!(normalize("إِنَّ الْمَدْرَسَةَ"), "ان المدرسه");
    }

    #[test]
    fn fts_terms_are_quoted() {
        assert_eq!(fts_expression("heart, chambers!"), "\"heart\" OR \"chambers\"");
    }

    #[test]
    fn natural_language_queries_keep_or_semantics() {
        // One unmatched content word must not blank the lexical leg: terms are OR-joined and
        // question-word stopwords are dropped (case-insensitively — normalize keeps casing).
        let expression = fts_expression("How do you determine the nature of the solutions of a quadratic equation?");
        assert_eq!(expression, "\"determine\" OR \"nature\" OR \"solutions\" OR \"quadratic\" OR \"equation\"");
    }

    #[test]
    fn punctuation_only_queries_are_empty() {
        assert_eq!(fts_expression("!?..."), "");
    }

    #[test]
    fn base64_round_trips_float_vectors() {
        let decoded = decode_vector("AACAPwAAAEA=").unwrap();
        assert_eq!(decoded, vec![1.0, 2.0]);
        assert_eq!(encode_vector(&[1.0, 2.0]), "AACAPwAAAEA=");
    }

    #[test]
    fn blobs_decode_only_at_the_expected_width() {
        let bytes: Vec<u8> = [1.0f32, 2.0].iter().flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(decode_blob(&bytes, 2), Some(vec![1.0, 2.0]));
        assert_eq!(decode_blob(&bytes, 3), None);
        assert_eq!(decode_blob(&bytes[..3], 0), None);
    }

    #[test]
    fn cosine_similarity_is_correct() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]).unwrap() - 1.0).abs() < 1e-9);
        assert!((cosine(&[1.0, 0.0], &[0.0, 1.0]).unwrap()).abs() < 1e-9);
        assert!((cosine(&[1.0, 0.0], &[-1.0, 0.0]).unwrap() + 1.0).abs() < 1e-9);
    }
}
