# Expected facts — DiveeOI_Scientific_Research.pdf (extracted via pdftotext, /tmp/isef_doc.txt)

Source doc: bilingual (Arabic body, English keywords). Author: عبدالرحمن أيمن محمد عثمان (Abdelrahman Ayman Mohamed Osman). ~10 pages.

## Fact 1 — Teacher model (BGE-M3, ~560M params, ~2.27 GB RAM)
Source (p.1, intro / research problem): «المشّفر متعدد اللغات BGE-M3 الذي يفهرس الكتب يضم نحو 560 مليون معامل ويستهلك عند تشغيله ذاكرة تقارب 2.27 جيجابايت، وهو ثقيل جداً على أجهزة المدارس إذا شُغّل مع كل استعلام»
= The multilingual encoder BGE-M3 that indexes the books has ~560 million parameters and consumes ~2.27 GB of memory when run.

## Fact 2 — Student encoder "DiveeQuery" (16,801,792 params, architecture)
Source (p.3): «وعلى خط التدريب بُني «طالب» مشّفر الاستعلام DiveeQuery شبكة محوّل صغرية بـ 16,801,792 معاماً (طبقة إخفاء 384، أربع طبقات، ستة رؤوس انتباه، شبكة تغذية أمامية 1536)، ومفردة (BPE) من 24,112 رمزاً تغطي 96.6% من مفردة المعلم، وتنتهي بطبقة إسقاط من 384 إلى 1024»
= Student query encoder "DiveeQuery": 16,801,792 parameters, hidden size 384, 4 layers, 6 attention heads, FFN 1536, BPE vocab 24,112 tokens covering 96.6% of teacher vocab, projection 384→1024 (1024-dim embeddings). Teacher: BGE-M3.

## Fact 3 — Training data (8,000 examples; 3,923 ar / 2,552 en / 1,448 fr / 77 ar-ling)
Source (p.3): «دُرِّب الطالب على 8,000 مثال (3,923 عربياً و 2,552 إنجليزياً و 1,448 فرنسياً و 77 مثالاً عرب-لغويا)»
= Student trained on 8,000 examples (3,923 Arabic, 2,552 English, 1,448 French, 77 Arabic-linguistic).

## Fact 4 — Model sizes (ONNX fp32 69.2 MB → int8 18.9 MB; 3.7× smaller than fp32, 120× smaller than teacher, 0.83% of teacher)
Source (p.3): «مُصدَّر إلى ONNX بحجم 69.2 ميغابايت، وخضع للتكميم (quantization) إلى دقة int8 فبلغ 18.9 ميغابايت (3.7 مرة أصغر من fp32 و 120 مرة أصغر من المعلم)»
Source (p.8): «من نموذج معلم بحجم 2,270 ميغابايت إلى طالب ONNX بحجم 18.9 ميغابايت بعد التكميم (أي 0.83% من الحجم) مع زمن استجابة استعلام منافس (34.2 مقابل 36.0 ميلي ثانية في الوضع الهجني على معالج ثماني النواة)»

## Fact 5 — Rust retrieval sidecar "divee-retrieval" (4.0 MB, 1,947 lines, ort+tokenizers crates, pure Rust, no Python in query path; hybrid = semantic + BM25 reciprocal rank fusion)
Source (p.3): «(hybrid retrieval): دمج نتائج البحث الدلالي مع البحث النصي (BM25) عبر دمج الرتب المتبادل، أي أن مسار الاستعلام لا يستدعي Python إطلاقاً. ثنائي Rust مستقل اسمه divee-retrieval حجمه 4.0 ميغابايت (1,947 سطراً، مكتبتا ort و tokenizers)»
Source (p.1): «تضاف إليها 1,947 سطر Rust لثنائي الاسترجاع و 3,444 سطر Python لخط أنابيب التدريب»

## Fact 6 — Final evaluation table (Table 2: 827 validation queries, hybrid mode) — student vs teacher vs ratio vs gate
Source (Table 2, p.6): «الجدول ٢: نتائج التقييم النهائي للطالب مقابل بوابات الإتقان (827 استعلام تحقق، الوضع الهجين)»
- recall@5: student 0.197 / teacher 0.537 / ratio 0.367 / gate 0.93 → راسب (fail)
- recall@10: student **0.287** / teacher 0.578 / ratio 0.496 / gate 0.95 → fail
- mrr@10: student 0.078 / teacher 0.451 / ratio 0.172 / gate 0.93 → fail
- ndcg@10: student **0.127** / teacher 0.482 / ratio 0.263 / gate 0.93 → fail
«بلغت نسبة الطالب إلى المعلم 0.367 للاستدعاء عند 5 و 0.496 عند 10 و 0.263 لـ NDCG و 0.172 لـ MRR»
NOTE: the strongest epoch (epoch 10 of training curve) reached absolute NDCG@10 0.122 (loss 6.254→1.938, relative to teacher 4.0%→25.3%): «انخفضت الخسارة الكلية (loss) من 6.254 إلى 1.938، وارتفع NDCG@10 المطلق من 0.019 إلى 0.122، وارتفعت نسبة NDCG إلى جودة المعلم من 4.0% إلى 25.3%» — training: 10 epochs on CPU, batch 32, 8 threads, 17.2–20.2 min/epoch (~3h total), eval on 827 queries each epoch.

## Fact 7 — Server/tests headline numbers (conclusion strip)
Source (p.8): «18.9 MB int8 encoder • 34.2 ms/query • 2,485 req/s • 1.9s startup • 98.6 tests pass • 18 languages»
Also: 448k lines repo, 4,748/4,815 tests pass (98.6%), 2,770/2,785 server tests in 342s, median /global/health latency 0.66 ms, RSS ~0.9 GB, 29 providers, 43 tools, 18 languages.
