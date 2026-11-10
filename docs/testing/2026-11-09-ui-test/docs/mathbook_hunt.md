# Task C3-locate-mathbook — Evidence Log
Target: source file of "Mathematics (English) - Part 1" (~204 pages, 552 passages), previously indexed in DiveeOI Targeted Learning on VDS.
Rules honored: read-only, no credentials/token file contents printed, max 8 vds.py calls.

## Plan
1. books.db rows + tables + TL dir layout
2. Filesystem search for math-named books + PDFs + shell history
3. Adaptive follow-ups (chunks table / orphaned ids / deleted traces / /tmp)

---
## CALL 1 (vds.py) — books.db + TL dir
- books table has ONLY 1 row: `bk_1054259ed5844b74 | DiveeOI Scientific Research | diveeoi-scientific-research | ready | /home/celestial-dev/.local/share/diveeoi/targeted-learning/books/44df683d606cacffdf2eac59b58eb8d4d6308f187c4422e421693362ec89050d.pdf`
- Tables present: books, book_notes, chunks, chunk_vecs, sections, ingest_jobs, meta, chunks_fts(+_data/_docsize/_idx)
- TL dir contains: `books/` subdir (exists!), books.db (5,763,072 B), WAL/shm, and SEVEN `books.db.corrupt-*` backups (94,208 B, 4,096 B; from Oct 29–30) with -shm/-wal companions.
- No `sources/` or `uploads/` dirs (they don't exist).
- NEXT: list books/ dir; check chunks for orphaned book_ids; grep corrupt DBs for the math row.
## CALL 2 (vds.py) — books/ dir, orphaned rows, corrupt DBs
- books/ dir contains ONLY: 44df683d606cacffdf2eac59b58eb8d4d6308f187c4422e421693362ec89050d.pdf (927,214 B) — matches the single remaining book (DiveeOI Scientific Research).
- chunks table: only bk_1054259ed5844b74 (50 chunks) — math book chunks (552) are NOT in chunks.
- sections table has ORPHANED book_ids: bk_2e9f86e3c5c041c3(3), bk_59a4c81b6aeb4ccf(30), bk_5e4f6d18c33342f6(93), bk_6c6fd98068704410(3), bk_7c79fd77b3be46ad(1), bk_cddeda45b34546c5(3), bk_e68fb8fbba214f93(3). bk_5e4f6d18c33342f6 (93 sections) is the strongest candidate for the ~204-page math book.
- ingest_jobs: mix of complete/failed for many book ids (incl. orphaned ids) — jobs table may record original filename.
- corrupt DBs: ~15 backups; some lack a books table, rest have books table with NO rows (empty at corruption time). No recoverable row there.
- NEXT: sections titles for orphan ids; ingest_jobs columns/rows; meta; then filesystem-wide search + history.
## CALL 3 (vds.py) — schema dump (response truncated, partial but valuable)
- sections schema: id, book_id, parent_id, level, title, page_start, page_end, ord, TEXT `text`, heading_path — orphaned sections STILL CONTAIN BOOK TEXT (reconstruction possible).
- ingest_jobs schema: id, book_id, stage, status, progress, checkpoint_json, error, started_at, finished_at.
- checkpoint_json preview (job for bk_cddeda45b34546c5, summary stage, complete): settings include "keepSourceFiles":true, download endpoint "huggingface.co", maxBookSizeMB 200 → TL pipeline keeps source files by default.
- My hex-literal SQL trick failed; retry with proper string literals (call 4).
## CALL 4 (vds.py) — identify math book among orphans
- Orphaned book ids + first section title:
  - bk_2e9f86e3c5c041c3: "Chapter 1 Photosynthesis" (EN biology)
  - bk_59a4c81b6aeb4ccf: "Slide 1: General pharmacology"
  - bk_5e4f6d18c33342f6: mojibake title, looks like "2603…教科書表4" (JP textbook listing?) — 93 sections, MATCHED math-like text
  - bk_6c6fd98068704410: Arabic "الفصل الأول التمثيل الضوئي"
  - bk_7c79fd77b3be46ad: (empty title) — MATCHED math-like text ("Mathematics" or "quadratic" in section text)
  - bk_cddeda45b34546c5: "Chapter 1 Photosynthesis"
  - bk_e68fb8fbba214f93: Arabic photosynthesis
- book_notes: empty. ingest_jobs.checkpoint_json = pipeline settings only (keepSourceFiles:true), no filename.
- NEXT: pull bk_7c79fd77b3be46ad section text; size of bk_5e4f6d18c33342f6 text; check chunks_fts shadow tables for orphaned full-text entries (deleted chunks may still be in chunks_fts_*).
## CALL 5 (vds.py) — orphan ID verification + FTS
- bk_7c79fd77b3be46ad = tiny TEST PROBE book ("DiveeOI probe book for ingest test v2 runtime… discriminant of a quadratic…"). NOT the real math book.
- bk_5e4f6d18c33342f6: 93 sections, 320,698 chars total — plausible 150-200-page book. Its title is UTF-8-as-cp1252 mojibake decoding to "エジプト教科書表4"-style (≈ "Egypt textbook table 4") → could plausibly BE the "Mathematics (English) - Part 1" (Egyptian curriculum) book, needs corroboration.
- chunks_fts is fts5 EXTERNAL CONTENT (content='chunks'); chunks_fts_docsize count = 50 = exactly the live book's chunk count → NO orphaned FTS text; deleted books' chunks are fully purged from main books.db. FTS MATCH 'quadratic'/'photosynthesis' = 0.
- book_notes empty. → DB holds NO recoverable math-book text except possibly bk_5e4f6d18c33342f6 sections (320 KB text).
- NEXT: filesystem-wide hunt for source files + shell history.
## CALL 6 (vds.py) — FILESYSTEM HIT
- No math-named book files in /tmp, /root, or home dirs (only dev/SDK noise: rustdoc, go src, python site-packages).
- BIG HIT: `/home/celestial-dev/diveeoi-artifacts/eb-pdf/` — an artifacts stash of curriculum PDFs, incl.:
  - `Mathematics-En-EB-Assessments-1.pdf`
  - `Eng-L2-EB-Part1.pdf`, `Eng-L1-EB-Part1.pdf`, `Physics-En-EB-Part2.pdf`, `Chemistry-*-EB-part1.pdf`, `EgyptianHistory-Ar-EB-part2.pdf`, `Programming-ArtificialIntelligence-Ar-EB-part2.pdf` …
  - Listing was truncated at 25 entries → a `Mathematics-En-EB-part1` PDF may exist below the cutoff. MUST list eb-pdf fully with sizes.
- /home/celestial-dev/DiveeOI/ = project docs (DiveeOI_Scientific_Research etc.) — matches remaining book, not math.
- Trash: empty/absent. Downloads: only an .mp4. History: zsh_history has just 'cd targeted-learning' (limited clue).
- DiveeOI state dirs: ~/.local/state/{diveeoi,diveeoi-ci,diveeoi-ci-platform}.
- NEXT: full `ls -la eb-pdf/` + page counts of Mathematics* candidates + artifacts dir map.
## CALL 7 (vds.py) — **PRIMARY RECOVERY CANDIDATE FOUND** (response truncated, root listing captured)
- `/home/celestial-dev/diveeoi-artifacts/` (artifacts root) contains:
  - **`Mathematics-EN-Part1.pdf` — 1,248,223 bytes, mtime Nov 8 23:03** ← almost certainly the deleted "Mathematics (English) - Part 1" source
  - `diveeoi-corpus-backup.tgz` (5,364,553 B) and `diveeoi-data-backup.tgz` (13,289,937 B) — corpus/data backups, Nov 4
  - subdirs: __pycache__, bench-v2/v3/v5, corpus, dataset, dataset-v5, dataset8k, eb-pdf (42+ curriculum PDFs incl. Mathematics-En-EB-Assessments-1.pdf), eval-cross-v3a/b.json …
- Response truncated before eb-pdf full listing + pdfinfo page counts → one final targeted call (call 8).
## CALL 8 (vds.py) — FINAL VERIFICATION (budget exhausted: 8/8)
- `/home/celestial-dev/diveeoi-artifacts/Mathematics-EN-Part1.pdf`: PDF 1.7, **30 page(s)**, 1,248,223 B, mtime 2026-11-08 23:03:49 UTC. (30 pages ≠ ~204 → likely a sample/subset copy, not the full indexed source.)
- pdfinfo NOT installed on VDS (no page output for Assessments-1 either); `file` cmd provided page count.
- `/home/celestial-dev/diveeoi-artifacts/corpus/` = **BACKUP of TL data from Nov 5**: `books.db` 67,215,360 B (13× larger than live books.db → likely contains deleted books' rows+chunks!), `eb-passages.jsonl` 4,021,157 B (extracted EB passages), `eb-extract.json`, `eb-summary.json`, `real-queries.jsonl`, `corpus.json`.
- Full eb-pdf stash (39 files) includes **`Mathematics-En-EB-Part1.pdf`** (exact naming match for "Mathematics (English) - Part 1"; size not captured — budget out) + `Mathematics-Ar-EB-Part1.pdf`, `Mathematics-En-EB-Assessments-1.pdf`, `Mathematics-Fr-EB-Part2.pdf`.

## CONCLUSIONS
(a) Source file EXISTS on VDS: `/home/celestial-dev/diveeoi-artifacts/eb-pdf/Mathematics-En-EB-Part1.pdf` (size TBD) and `/home/celestial-dev/diveeoi-artifacts/Mathematics-EN-Part1.pdf` (1,248,223 B, 30 pages).
(b) Live books row: GONE — books table has only bk_1054259ed5844b74 (DiveeOI Scientific Research); books/ dir has only its PDF (927,214 B).
(c) Deletion evidence: math book chunks purged from chunks table (only 50 chunks, all live book) and from FTS (external-content fts5, docsize=50); 7 orphaned books' sections remain (incl. bk_5e4f6d18c33342f6, 93 sections/320,698 chars, mojibake title ≈ "エジプト教科書表4"); corrupt-DB backups have no book rows.
(d) BEST RECOVERY OPTIONS (pull order):
  1. `/home/celestial-dev/diveeoi-artifacts/eb-pdf/Mathematics-En-EB-Part1.pdf` — exact title match, size unknown (fetch via stat).
  2. `/home/celestial-dev/diveeoi-artifacts/Mathematics-EN-Part1.pdf` — 1,248,223 bytes, 30 pages (probably partial/sample).
  3. `/home/celestial-dev/diveeoi-artifacts/corpus/books.db` — 67,215,360 B Nov-5 backup DB; may hold the original books row + all 552 chunks/passages as text (query offline after pulling).
  4. `/home/celestial-dev/diveeoi-artifacts/corpus/eb-passages.jsonl` — 4,021,157 B; grep for Mathematics passages.
No credentials/tokens/enrollment files were read or printed. Read-only investigation throughout.
