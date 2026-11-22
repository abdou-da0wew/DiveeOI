# tl:eval fixtures

Fixtures for the offline eval harness (`bun run tl:eval`,
`packages/learning/test/eval-harness.test.ts`). Everything here runs with the
deterministic standin embedder — no model files, no network.

## Files

- `corpus/biology-basics.txt`, `corpus/astronomy-essentials.txt` — two mini
  books (fixture corpus format, see below). The test builder turns each into
  a books.db book with deterministic ids:
  - book id = the slug from the header line (`# <slug> | <title> | <lang>`)
  - section ids `<slug>-s<ord>`, chunk ids `<slug>-c<ord>` (ord counts chunks
    across the whole book, 0-based)
  - each blank-line-separated paragraph inside a section is one chunk
  - `chunk.page` = chunkIndex + 1 (synthetic paging so `expectedPageRange`
    expectations are discriminative; real PDF corpora carry real pages)
  - chunk vectors = the standin hash embedder (`src/eval/embedder.ts`)
- `golden-biology.json`, `golden-astronomy.json` — golden sets (schema v2),
  12–14 questions per book covering every question kind.

## Golden-set JSON schema (v2)

```jsonc
{
  "schemaVersion": 2,
  "name": "…",
  "description": "…",                    // optional
  "role": "student" | "teacher",         // optional; both roles present → comparison table
  "questions": [
    {
      "id": "unique-question-id",
      "bookSlug": "…",                   // portable; or "bookId" (books.db id)
      "query": "the question text",
      "language": "ar" | "en" | "fr",
      "kind": "in-book" | "paraphrased" | "cross-lingual" | "follow-up" | "off-topic",
      // expectations (at least one for in-book/paraphrased/cross-lingual):
      "expectedChunkIds": ["…"],         // exact chunk ids (stable only for synthetic corpora)
      "expectedSectionTitles": ["…"],    // case-insensitive substring match on
                                         // sections.title / sections.heading_path
      "expectedPageRange": { "start": 3, "end": 5 },
      "followUpOf": "other-question-id", // for follow-ups; parent query feeds the rewriter
      "note": "…"                        // optional
    }
  ]
}
```

Rules (enforced by `parseGoldenSet` in `src/eval/golden.ts`):

- Every question needs `bookId` or `bookSlug`.
- `off-topic` questions must NOT carry expectations (they must be refused).
- `in-book` / `paraphrased` / `cross-lingual` questions need at least one
  expectation; `follow-up` questions inherit expectations normally.
- A candidate chunk is RELEVANT when it satisfies ANY given expectation
  (chunk id, section title → any chunk of the section, or page range).
- Expectation granularity drives recall semantics: the metrics mirror
  `training/metrics.py`, so recall@k = |top-k ∩ relevant| / |relevant| per
  question, averaged. A question pointing at a whole 10-chunk section needs
  all 10 chunks in the top-k to score 1.0 — prefer page/chunk-level
  expectations when the question targets one passage.

## Question kinds (10–20 questions per book)

- `in-book` — answerable from the book; expectation = where the answer lives.
- `paraphrased` — reworded in-book question (tests beyond-exact-lexical
  matching).
- `cross-lingual` — query language ≠ language of the expected content
  (Arabic ↔ English/French per RETRIEVAL_V2_PLAN.md §10). Only a
  multilingual encoder (bge-m3 / promoted student) can pass these; the
  standin hash embedder honestly fails them.
- `follow-up` — anaphoric ("explain more"); `followUpOf` names the parent
  question whose query is fed to the production rewriter.
- `off-topic` — must be refused by the gate (gate recall / false-refusal
  metrics).

## Promotion gates

The report evaluates the §7 gates (`src/eval/gates.ts`, same contract as
`training/promote.py`): recall@10 ≥ 0.95, recall@5 ≥ 0.93, MRR@10 ≥ 0.93,
nDCG@10 ≥ 0.93 (student/teacher ratios when both encoders run, absolute
values otherwise — the report labels the semantics), cross-lingual
recall@10 ≥ 0.90 (slices under 20 queries are recorded as SKIPPED, never
counted as coverage), gate separability (in-book p5 above off-topic p95),
false-refusal increase ≤ 2 pp, plus advisory p95-latency and RSS rows and the
HNSW recommendation. A standin run is expected to FAIL the promotion gates —
that is the harness working, not the harness failing.
