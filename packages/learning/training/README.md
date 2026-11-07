# Divee query-student training toolkit

Offline tooling for distilling a compact query encoder into BGE-M3's existing 1024-dimensional passage-vector space. The teacher embeds books; a smaller student can later embed chat questions without re-indexing those books.

Nothing in this directory runs in the normal server/chat process. It is a training, evaluation, corpus-preparation, and artifact-promotion toolkit.

## Compatibility contract

| Item | Contract |
|---|---|
| Embedding space | 1024 dimensions, matching stored BGE-M3 passage vectors |
| Pooling | CLS |
| Normalisation | L2 |
| Tokenizer | BGE-M3/XLM-R tokenizer and compatible token IDs |
| Maximum query length | 128 tokens |
| ONNX inputs | `input_ids`, `attention_mask` |
| ONNX output | `last_hidden_state`; runtime applies CLS pooling and L2 normalisation |
| Existing book vectors | Read from `books.db`; never re-embedded by student training |

Changing these values requires a new compatibility strategy and evaluation against existing indexes. The runtime manifest includes the promotion state and gate results; a student is not selected by `queryEncoder=auto` until it is marked promoted.

## Install and smoke test

Use a dedicated Python environment on the training machine:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python smoke_test.py
```

The CPU smoke test exercises a tiny synthetic model, gradients through vocabulary remapping, ONNX export, and INT8 quantisation when the required runtime packages are available. It validates the toolchain, not retrieval quality or production suitability.

## End-to-end workflow

Run from `packages/learning/training`. Use a finished, backed-up `books.db` and keep the data, checkpoint, report, and runtime artifact directories distinct.

```sh
# 1. Build a dataset from the indexed passages and stored teacher vectors.
python build_dataset.py \
  --db ~/.local/share/diveeoi/targeted-learning/books.db \
  --out data/

# Prefer real captured questions when available; augment/replace behaviour is explicit.
python build_dataset.py \
  --db ~/.local/share/diveeoi/targeted-learning/books.db \
  --out data/ \
  --queries real-queries.jsonl \
  --real-query-mode augment

# 2. Train the student. GPU is recommended; CPU is supported but slower.
python train.py --data data/ --out models/student/ --epochs 6

# 3. Export the runtime directory (fp32 ONNX plus optional INT8 quantisation).
python export.py --model models/student/ --data data/ --out models/student-runtime/

# 4. Evaluate the held-out split using the same split configuration as training.
python eval.py \
  --data data/ \
  --model models/student/ \
  --report eval-report.json \
  --db ~/.local/share/diveeoi/targeted-learning/books.db \
  --rust-bin ../native/retrieval/target/release/divee-retrieval \
  --emit-bench bench/

# 5. Promote only after every configured quality and gate criterion passes.
python promote.py --report eval-report.json --model models/student-runtime/

# 6. Install the complete runtime artifact under the Targeted Learning data directory.
cp -r models/student-runtime ~/.local/share/diveeoi/models/divee-query-student
```

Check each script's `--help` output before adapting a command to a different corpus or split. The evaluation tool can emit engine benchmark JSONL files for the Rust engine; it passes explicit book IDs so the benchmark searches the intended corpus.

## Dataset quality and language coverage

The builder supports Arabic, English, and French passage/query data. The synthetic query pool now mixes roughly 8–10 honest candidate forms per passage/language from headings and sentence spans: raw heading/span cuts, question/explain/how/why forms, and keyword cuts. It does not invent factual content. The configured `--queries-per-passage` selects the subset retained for each passage.

Captured questions supplied with `--queries` are preferred for realistic evaluation. Keep their source, language, book IDs, and relevance judgements intact. Synthetic data is a useful bootstrap and coverage aid, not a substitute for real user query distribution.

The Egyptian Baccalaureate corpus workflow (`colab_eb_corpus.py`) downloads the source PDFs, extracts text in isolated workers, uses OCR for image-based scans, and builds/appends the book/vector corpus. OCR workers can process pending books in parallel while each worker remains resource-limited and isolated. The Wikipedia stand-in builder appends idempotently rather than recreating the corpus database.

## Evaluation and promotion

The evaluator reports ranking metrics overall and across tag/language-pair slices. Cross-lingual slices have a minimum sample floor; slices that cannot meet it are recorded as skipped in the promotion manifest rather than silently treated as passing. Engine evaluation scopes searches to selected book IDs. Gate calibration compares in-book and off-topic score distributions.

Default promotion ratios are evaluated against the teacher on a held-out set:

- Recall@10: at least 0.95 of teacher.
- Recall@5: at least 0.93.
- MRR@10 and nDCG@10: at least 0.93 each.
- Cross-lingual Recall@10: at least 0.90.
- Gate false-refusal increase: bounded by the configured tolerance; off-topic false-accept behaviour must also remain acceptable and thresholds must be separable.

A failed gate leaves the model unpromoted. The `--force` override is explicit and recorded in the manifest; it must not be mistaken for a successful quality promotion. Inspect the JSON report and `divee-student.json` before changing runtime settings.

## Corpus helpers

- `colab_corpus.py`: Wikipedia-derived stand-in corpus for Arabic/English.
- `colab_eb_corpus.py`: Egyptian Baccalaureate PDFs, including Arabic/English/French subjects and assessments.
- `build_dataset.py`: query/teacher target generation, vocabulary pruning, hard-negative mining.
- `train.py`: student optimisation and held-out validation.
- `eval.py`: overall and sliced retrieval metrics, off-topic gate evaluation, optional native-engine benchmarks.
- `export.py`: ONNX export, quantisation, tokenizer/config and runtime manifest assembly.
- `promote.py`: promotion gates and manifest state.

## Important caveats

- The corpus must have meaningful, relevant query judgements. A synthetic query set alone can overstate performance on its own templates.
- Student and teacher are compared against the vectors actually stored in the target `books.db`; this is the deployed retrieval space.
- A smoke test proves that training/export plumbing executes. It does not prove model quality, cross-lingual generalisation, latency, or memory targets.
- Keep the teacher available until the promoted student is installed and validated. The server's `auto` mode safely uses BGE-M3 when no promoted student is present.

See [Retrieval V2 plan](../RETRIEVAL_V2_PLAN.md) for architecture, hard constraints, and the promotion checklist.
