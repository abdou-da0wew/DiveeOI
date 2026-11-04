# Divee query-student trainer

Offline tooling that turns a finished `books.db` into a small Arabic+English query encoder which
reproduces BGE-M3's 1024-d query space. Once the student is promoted, chat no longer loads BGE-M3
(see `../RETRIEVAL_V2_PLAN.md`).

Nothing here runs inside the app. It is the "index once, then forget the teacher" half of
Retrieval V2.

## Contract (do not change without re-indexing every book)

| Item | Value |
| --- | --- |
| Output | 1024 floats, CLS pooled, L2 normalised |
| Tokenizer | the BGE-M3/XLM-R tokenizer, unchanged (the pruned vocabulary lives inside the graph) |
| Query length | 128 tokens |
| Passage space | BGE-M3 vectors already stored in `books.db` — never re-embedded by this toolkit |
| ONNX signature | inputs `input_ids`, `attention_mask`; output `last_hidden_state` |

The runtime applies CLS pooling + normalisation exactly as it does for the teacher, which is why
the graph exports `last_hidden_state` and not a pooled vector.

## Install

```sh
pip install -r requirements.txt      # torch, transformers, onnx, onnxruntime, numpy
python smoke_test.py                 # metrics always; training/export when torch is present
```

`smoke_test.py` is safe on a laptop CPU: it trains a 1-layer toy model for six steps, checks the
gradients flow through the vocabulary remap, exports ONNX, and (if `onnxruntime` exists) quantizes
to INT8.

## Pipeline

```sh
# 1. dataset: queries + teacher targets + pruned vocabulary + hard negatives
python build_dataset.py --db ~/.local/share/diveeoi/targeted-learning/books.db --out data/

#    (preferred) with real captured questions instead of synthesized ones
python build_dataset.py --db ... --out data/ --queries real-queries.jsonl

# 2. train (GPU strongly recommended; CPU works but slowly)
python train.py --data data/ --out models/student/ --epochs 6

# 3. export the runtime directory (ONNX fp32 -> INT8, tokenizer/config copied from the teacher)
python export.py --model models/student/ --data data/ --out models/student-runtime/

# 4. evaluate: student vs teacher, per slice, plus gate score distributions
python eval.py --data data/ --model models/student/ --report eval-report.json \
  --db ~/.local/share/diveeoi/targeted-learning/books.db \
  --rust-bin ../native/retrieval/target/release/divee-retrieval --emit-bench bench/

# 5. promote only if the gates pass (writes divee-student.json with promoted=true + gate thresholds)
python promote.py --report eval-report.json --model models/student-runtime/

# 6. install it
cp -r models/student-runtime ~/.local/share/diveeoi/models/divee-query-student
```

## Corpus: Egyptian Baccalaureate textbooks + Wikipedia stand-in

`colab_corpus.py` builds a stand-in `books.db` from streamed Wikipedia articles (ar/en) so the
toolkit has an honest corpus before the app has indexed real books. `colab_eb_corpus.py` ingests
the official Egyptian Baccalaureate PDFs (Ar/En/Fr subjects + assessments) into the same db:

```sh
# on a Colab T4 runtime (stages: download -> extract -> ocr -> db)
python colab_eb_corpus.py --stage all
#   download : the 40 PDFs from the EB blob storage (socket timeout, size-validated, atomic)
#   extract  : PyMuPDF text layer -> per-page chunks, one isolated worker per book
#              (RLIMIT_AS + wall clock; a memory-bomb PDF degrades to an error book)
#   ocr      : tesseract (ara/eng/fra) at 150 dpi for books without a text layer,
#              also one isolated worker per book
#   db       : embed every chunk with the fp32 BGE-M3 teacher, append books/chunks/chunk_vecs
#              to /content/corpus/books.db, and append real queries (incl. cross-lingual pairs
#              aligned by relative position across the Ar/En/Fr editions) to real-queries.jsonl
```

Both corpus scripts write the app's exact books.db schema, so the output doubles as a ready-to-use
library for the app (and for the Rust engine's `--compact` + engine-level eval).

`build_dataset.py` is language-aware for ar/en/fr (synthesized question templates per language,
`lang_pair` reporting across the three), and `eval.py` calibrates the refusal gate with ar/en/fr
off-topic probes.

## Judged slices

| Slice | Source | Why |
| --- | --- | --- |
| `heading`, `span`, `question`, `explain` | synthesized | everyday retrieval |
| `real` | `--queries` | the distribution that matters |
| `ar->en`, `en->ar` | `--queries` (or Arabic books with English probes) | cross-lingual recall |
| off-topic probes | built into `eval.py` | gate false-accept / false-refusal calibration |

`eval.py` also writes `bench-teacher.jsonl` / `bench-student.jsonl`; `divee-retrieval --eval`
turns them into engine-level Recall@5/10, MRR@10, nDCG@10 and latency, i.e. the numbers that
include BM25, Arabic normalisation and RRF.

## Promotion gates

Student / teacher ratios on a held-out set (`promote.py` defaults):

* Recall@10 ≥ 0.95, Recall@5 ≥ 0.93, MRR@10 ≥ 0.93, nDCG@10 ≥ 0.93
* cross-lingual Recall@10 ≥ 0.90
* separable gate: student in-book p5 > off-topic p95, else no threshold can separate them

Failing a gate leaves `promoted: false`, so `retrieval.queryEncoder=auto` keeps using BGE-M3.

## Knobs when quality is short

1. `--hidden 1024 --layers 8` (still ~3× smaller than the teacher, published BGE-M3 depth-pruning
   keeps quality this way).
2. More/better data: `--queries`, more `--queries-per-passage`, more hard negatives.
3. Longer training with `--w-cos 0.5 --w-nce 1.0 --w-kl 1.0` (ranking over vector imitation).
4. `--vocab-size 100000` if Arabic morphology is being pruned too aggressively.

## Two honest caveats

* Targets come from `BAAI/bge-m3` (fp32); the index was built with `Xenova/bge-m3` int8. Evaluation
  therefore always compares against the *stored* vectors, which is what chat actually uses.
* "Matching the teacher vector" is not the goal; the loss and the metrics are ranking-based for
  that reason.
