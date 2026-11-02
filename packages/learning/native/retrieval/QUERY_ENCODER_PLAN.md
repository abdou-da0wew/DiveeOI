# Targeted Learning: lightweight query encoder plan

## Goal

Keep existing BGE-M3 passage vectors and remove the full BGE-M3 runtime from normal chat retrieval. The server's steady-state target is below 1 GiB RSS; the larger teacher model is only needed for indexing, evaluation, and offline distillation.

## Important constraint

A passage vector does not contain enough information to embed an arbitrary future question. Cosine similarity compares two vectors; it does not turn text into a vector. A semantic query must be encoded into the same vector space as the already-indexed passages.

BM25-only retrieval avoids query embeddings but loses semantic recall for synonyms, paraphrases, and cross-language questions.

## Proposed architecture

1. **Teacher / indexing:** Keep the current BGE-M3 model for document chunk embeddings. Store normalized 1024-dimensional vectors exactly as today, so existing books do not need to be re-embedded just because the query encoder changes.
2. **Query student:** Train a compact multilingual query encoder to imitate BGE-M3 query embeddings. The student emits the same 1024-dimensional normalized vectors as the teacher.
3. **Training pairs:** For each indexed passage, create question/passage pairs. Include direct questions, paraphrases, hard negatives, Arabic queries for English passages, English queries for Arabic passages, and mixed-language queries. Generate teacher targets with BGE-M3 in the offline indexing/training pipeline.
4. **Distillation losses:** Combine cosine/MSE embedding imitation with a contrastive ranking loss against the existing BGE-M3 passage vectors. Optimize retrieval ranking as well as vector closeness; vector MSE alone does not guarantee good top-k retrieval.
5. **Runtime:** Load only the compact query student. Keep document vectors on disk. The Rust engine performs FTS5 BM25, cosine scoring, RRF fusion, book filtering, and top-k selection.
6. **Scale-up:** Start with exact cosine scans streamed from SQLite. Add an on-disk HNSW/ANN index once real book counts and latency measurements justify it. Build/update that index only after successful ingestion, atomically, and retain a fallback to exact cosine plus BM25.

## Acceptance gates

- Compare current BGE-M3 query embeddings against the student on a held-out query set.
- Measure Recall@5/10, MRR@10, nDCG@10, and gate false-accept / false-refusal rates.
- Include Arabic-only, English-only, cross-lingual, synonym, paraphrase, typo, and off-topic cases.
- Require quality to stay within an agreed tolerance before making the student the default.
- Confirm model load, inference latency, RSS peak, and concurrent-query behavior on the VDS.
- Keep BGE-M3 as a selectable fallback until the student is proven.

## Current implementation status

The Rust prototype now supports:
- Read-only SQLite FTS5 BM25.
- Decoding the existing base64 Float32 vectors.
- Exact cosine similarity over vectors scoped to selected book IDs.
- Streaming top-K retention rather than keeping the entire corpus in memory.
- RRF fusion and JSON output.

It is not yet integrated into TypeScript session retrieval, and it does not provide the query embedding itself. The current production chat path still calls `ensureEmbedder()` and BGE-M3 for every non-empty targeted-learning turn. Production behavior has not been changed by this prototype.
