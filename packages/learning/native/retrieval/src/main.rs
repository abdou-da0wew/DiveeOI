mod metrics;

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env,
    ffi::{CStr, CString, c_char, c_double, c_int, c_void},
    path::{Path, PathBuf},
    ptr,
    time::Instant,
};

const SQLITE_OK: c_int = 0;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;
const OPEN_READONLY: c_int = 1;
const OPEN_NOMUTEX: c_int = 0x8000;
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
    fn sqlite3_finalize(stmt: *mut Sqlite3Stmt) -> c_int;
    fn sqlite3_column_text(stmt: *mut Sqlite3Stmt, column: c_int) -> *const u8;
    fn sqlite3_column_int(stmt: *mut Sqlite3Stmt, column: c_int) -> c_int;
    fn sqlite3_column_double(stmt: *mut Sqlite3Stmt, column: c_int) -> c_double;
    fn sqlite3_busy_timeout(db: *mut Sqlite3, ms: c_int) -> c_int;
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
    limit: usize,
    dense_limit: usize,
    vector_base64: Option<String>,
    rrf_k: f64,
    bm25_weight: f64,
    dense_weight: f64,
    /// JSONL benchmark file; when set the binary reports quality metrics instead of hits.
    eval: Option<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut it = env::args().skip(1);
    let (mut db, mut query, mut books) = (None, None, Vec::new());
    let (mut limit, mut dense_limit, mut vector_base64) = (8usize, 30usize, None);
    let (mut rrf_k, mut bm25_weight, mut dense_weight) = (60.0f64, 1.0f64, 1.0f64);
    let mut eval: Option<PathBuf> = None;

    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--db" => db = it.next().map(PathBuf::from),
            "--query" => query = it.next(),
            "--book" => books.push(it.next().ok_or("--book requires an ID")?),
            "--limit" => {
                limit = it
                    .next()
                    .ok_or("--limit requires a number")?
                    .parse()
                    .map_err(|_| "invalid --limit")?;
            }
            "--dense-limit" => {
                dense_limit = it
                    .next()
                    .ok_or("--dense-limit requires a number")?
                    .parse()
                    .map_err(|_| "invalid --dense-limit")?;
            }
            "--vector-base64" => vector_base64 = it.next(),
            "--eval" => eval = it.next().map(PathBuf::from),
            "--rrf-k" => {
                rrf_k = it
                    .next()
                    .ok_or("--rrf-k requires a number")?
                    .parse()
                    .map_err(|_| "invalid --rrf-k")?;
            }
            "--bm25-weight" => {
                bm25_weight = it
                    .next()
                    .ok_or("--bm25-weight requires a number")?
                    .parse()
                    .map_err(|_| "invalid --bm25-weight")?;
            }
            "--dense-weight" => {
                dense_weight = it
                    .next()
                    .ok_or("--dense-weight requires a number")?
                    .parse()
                    .map_err(|_| "invalid --dense-weight")?;
            }
            "--help" | "-h" => {
                return Err(
                    "usage: divee-retrieval --db PATH --query TEXT --book ID [--book ID ...] \
                     [--vector-base64 BASE64] [--limit N] [--dense-limit N] | \
                     --db PATH --eval BENCH.jsonl [--book ID ...]"
                        .into(),
                );
            }
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }

    if !rrf_k.is_finite() || rrf_k <= 0.0 {
        return Err("--rrf-k must be a positive finite number".into());
    }
    if !bm25_weight.is_finite()
        || bm25_weight < 0.0
        || !dense_weight.is_finite()
        || dense_weight < 0.0
    {
        return Err("fusion weights must be finite and non-negative".into());
    }

    Ok(Args {
        db: db.ok_or("--db is required")?,
        query: match (query, &eval) {
            (Some(query), _) => query,
            (None, Some(_)) => String::new(),
            (None, None) => return Err("--query is required".into()),
        },
        books,
        limit: limit.clamp(1, 50),
        dense_limit: dense_limit.clamp(1, 100),
        vector_base64,
        rrf_k,
        bm25_weight,
        dense_weight,
        eval,
    })
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

fn fts_expression(query: &str) -> String {
    normalize(query)
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
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

fn sqlite_error(db: *mut Sqlite3, operation: &str) -> String {
    if db.is_null() {
        return format!("{operation}: SQLite database unavailable");
    }
    let message = unsafe { CStr::from_ptr(sqlite3_errmsg(db)) }.to_string_lossy();
    format!("{operation}: {message}")
}

fn open_db(path: &Path) -> Result<*mut Sqlite3, String> {
    let path =
        CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "invalid database path")?;
    let mut db: *mut Sqlite3 = ptr::null_mut();
    let rc = unsafe {
        sqlite3_open_v2(
            path.as_ptr(),
            &mut db,
            OPEN_READONLY | OPEN_NOMUTEX,
            ptr::null(),
        )
    };
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
        let rc =
            unsafe { sqlite3_bind_int(stmt, (args.books.len() + 2) as c_int, args.limit as c_int) };
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

    let placeholders = vec!["?"; args.books.len()].join(",");
    let sql = format!(
        "SELECT c.id,c.book_id,c.section_id,c.page,c.text,v.vec \
         FROM chunk_vecs v JOIN chunks c ON c.id=v.chunk_id \
         WHERE c.book_id IN ({placeholders})"
    );
    let sql = CString::new(sql).map_err(|_| "invalid SQL")?;
    let mut stmt: *mut Sqlite3Stmt = ptr::null_mut();
    let rc = unsafe { sqlite3_prepare_v2(db, sql.as_ptr(), -1, &mut stmt, ptr::null_mut()) };
    if rc != SQLITE_OK {
        return Err(sqlite_error(db, "prepare dense query"));
    }
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
                let encoded = unsafe { column_string(stmt, 5) };
                let bytes = match decode_base64(&encoded) {
                    Ok(bytes) => bytes,
                    Err(_) => continue,
                };
                if bytes.len() != query_vector.len() * 4 {
                    continue;
                }
                let vector: Vec<f32> = bytes
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|chunk| f32::from_le_bytes(*chunk))
                    .collect();
                let Some(score) = cosine(query_vector, &vector) else {
                    continue;
                };

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

fn fuse(args: &Args, bm25: Vec<Hit>, dense: Vec<Hit>) -> Vec<Hit> {
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
    results.truncate(args.limit);
    results
}

fn search_db(db: *mut Sqlite3, args: &Args) -> Result<Vec<Hit>, String> {
    let expression = fts_expression(&args.query);
    let lexical = run_bm25(db, args, &expression)?;
    let dense = match &args.vector_base64 {
        Some(encoded) => {
            let vector = decode_vector(encoded)?;
            run_dense(db, args, &vector)?
        }
        None => Vec::new(),
    };
    Ok(fuse(args, lexical, dense))
}

fn search(args: &Args) -> Result<Vec<Hit>, String> {
    let db = open_db(&args.db)?;
    let result = search_db(db, args);
    unsafe {
        sqlite3_close(db);
    }
    result
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
            Ok(hits) => hits,
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
    let outcome = parse_args().and_then(|args| match &args.eval {
        Some(path) => run_eval(&args, path)
            .and_then(|report| serde_json::to_string(&report).map_err(|e| e.to_string())),
        None => {
            search(&args).map(|hits| serde_json::to_string(&hits).unwrap_or_else(|_| "[]".into()))
        }
    });
    match outcome {
        Ok(json) => println!("{json}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arabic_normalization_handles_diacritics_and_letters() {
        assert_eq!(normalize("إِنَّ الْمَدْرَسَةَ"), "ان المدرسه");
    }

    #[test]
    fn fts_terms_are_quoted() {
        assert_eq!(fts_expression("heart, chambers!"), "\"heart\" \"chambers\"");
    }

    #[test]
    fn punctuation_only_queries_are_empty() {
        assert_eq!(fts_expression("!?..."), "");
    }

    #[test]
    fn base64_decodes_float_vectors() {
        let decoded = decode_vector("AACAPwAAAEA=").unwrap();
        assert_eq!(decoded, vec![1.0, 2.0]);
    }

    #[test]
    fn cosine_similarity_is_correct() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]).unwrap() - 1.0).abs() < 1e-9);
        assert!((cosine(&[1.0, 0.0], &[0.0, 1.0]).unwrap()).abs() < 1e-9);
        assert!((cosine(&[1.0, 0.0], &[-1.0, 0.0]).unwrap() + 1.0).abs() < 1e-9);
    }
}
