# Targeted Learning

**Current implementation guide · reviewed 2026-11-06**

Targeted Learning lets a session answer questions from selected books or documents using retrieved passages as its evidence. It is a separate subsystem with its own ingestion lifecycle, settings, library storage, diagnostics, and student-memory store.

## How a session works

1. **Prepare the library.** Complete model setup, then import or ingest a supported book/document. The ingestion pipeline extracts text, optionally performs OCR for image-based PDF pages, chunks the document, and embeds its passages with the pinned BGE-M3 teacher.
2. **Select the source.** Start a session with one or more books selected, or reference them with `@book:`. Targeted mode is sticky for the session and keeps the selected book set in its session metadata.
3. **Retrieve evidence.** The system runs lexical search (SQLite FTS5/BM25) and dense vector search, fuses the candidate lists with Reciprocal Rank Fusion, and expands child hits to useful parent context.
4. **Apply the gate.** A pre-LLM relevance gate can refuse an out-of-book question without making an LLM request. The prompt is grounded in the passages shown for that turn; answer citations are checked against the turn's retrieved evidence.
5. **Remember learning context.** Student notes and memories are stored separately from the main chat database and book index.

The guarantee is evidence-bounded retrieval and citation verification, not a mathematical guarantee that an LLM cannot phrase an unsupported statement. The product enforces the sources and checks citation references; review answers like any generated output.

## Storage boundaries

Targeted Learning does not collapse all project state into one database:

- The core application database stores normal DiveeOI sessions and application data.
- `books.db` stores the book catalogue, extracted structure, chunks, retrieval vectors, and indexing state.
- `student.db` stores Targeted Learning student memory/notes separately from book data.
- Model files, source files, OCR assets, and diagnostics live under the configured Targeted Learning data directory.

Back up the core application database and the Targeted Learning data directory. They are separate recovery units. See [Deployment](targeted-learning-deployment.md) for persistent volumes and offline setup.

## Retrieval V2

The current retrieval architecture separates model inference from retrieval policy:

- **Indexing teacher:** pinned `Xenova/bge-m3`, producing 1024-dimensional passage vectors.
- **Chat query encoder:** `retrieval.queryEncoder = auto | student | bge-m3`. In `auto`, an installed student is selected only when its manifest marks it promoted; otherwise BGE-M3 is used. The student emits the same 1024-dimensional CLS-pooled, L2-normalised space, so existing book vectors remain valid.
- **Retrieval engine:** `retrieval.engine = auto | native | typescript`. `auto` prefers the Rust engine if its binary exists, with TypeScript fallback on availability or runtime failure.
- **Teacher lifecycle:** `retrieval.unloadTeacherAfterIndexing` defaults to `true`; the teacher is unloaded after indexing drains unless chat still resolves to it.

The Rust engine owns the retrieval hot path: FTS5/BM25, dense cosine, score fusion, and candidate metrics. TypeScript owns query rewriting, gates, parent expansion, session integration, and fallback policy. The Rust process uses persistent NDJSON serving rather than spawning a process for every query.

The offline toolkit in `packages/learning/training` builds training data, trains/exports a student, evaluates it against held-out retrieval slices, and writes a promotion manifest only after gates pass. The code and setting exist independently of whether a trained, evaluated, promoted model is installed on a specific host.

## Main settings

The schema and defaults are maintained in:

- `packages/learning/src/settings/schema.ts`
- `packages/learning/src/settings/defaults.ts`

The most relevant retrieval defaults are:

| Setting | Default | Meaning |
|---|---:|---|
| `retrieval.engine` | `auto` | Prefer Rust when installed; otherwise TypeScript |
| `retrieval.queryEncoder` | `auto` | Use a promoted student when available; otherwise BGE-M3 |
| `retrieval.unloadTeacherAfterIndexing` | `true` | Release the indexing model when safe |
| `retrieval.bm25TopK` | `30` | Lexical candidates before fusion |
| `retrieval.denseTopK` | `30` | Vector candidates before fusion |
| `retrieval.rrfK` | `60` | Reciprocal Rank Fusion constant |
| `retrieval.finalTopK` | `8` | Final context candidates |
| `gate.minDenseScore` | `0.5` | Default dense relevance threshold |
| `embedding.dtype` | `int8` | Default teacher quantization |

The server validates settings at the boundary. Treat the schema as the authoritative list of accepted keys and ranges rather than copying an incomplete config sample into production.

## API and operations

The instance HTTP API is mounted under `/targeted-learning`. It includes setup status/start/repair/cancel/local-import, settings read/update/schema, library/book operations, ingest-job lifecycle, search/probe, student-memory operations, and diagnostics. Use the authenticated status and debug routes rather than assuming the UI is the only operational interface.

- [API reference](api.md)
- [Configuration](configuration.md)
- [Deployment](targeted-learning-deployment.md)
- [Debugging and live validation](targeted-learning-debugging.md)
- [Retrieval V2 plan](../packages/learning/RETRIEVAL_V2_PLAN.md)
- [Training toolkit](../packages/learning/training/README.md)
- [Native retrieval engine](../packages/learning/native/retrieval/README.md)

## Important validation boundary

The latest full monorepo verification recorded in the worklog predates the November 4–6 implementation commits. The current code's settings/schema and data pipeline are described here, but do not treat the November 3 test counts as verification of the November 6 source HEAD. Check the current worklog/release hand-off for the actual verification boundary.
