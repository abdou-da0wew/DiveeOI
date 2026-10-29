#!/usr/bin/env bun
// scripts/tl-live-check.ts
//
// Real-model check + gate calibration for Targeted Learning. Run it against a running DiveeOI
// server that can reach huggingface.co (e.g. your VDS):
//
//   bun scripts/tl-live-check.ts                        # BASE defaults to http://localhost:4097
//   BASE=http://127.0.0.1:4097 bun scripts/tl-live-check.ts --dtype int8 --apply
//
// What it does (no LLM or provider needed):
//   1. Start Setup (download + verify + load bge-m3 + self-test + benchmark) and wait for Ready.
//   2. Upload two small books (English + Arabic) and wait until they are indexed.
//   3. Ask in-book / off-topic / small-talk questions through POST /targeted-learning/search and
//      record the real dense scores the gate sees.
//   4. Recommend a gate threshold from those scores; --apply writes it to the settings.
//   5. Print a pass/fail table and exit non-zero on any failure.
//
// Flags: --dtype int8|q4f16|fp16|fp32  --apply  --keep (keep the test books)  --skip-setup

const BASE = (process.env.BASE ?? "http://localhost:4097").replace(/\/+$/, "")
const T = `${BASE}/targeted-learning`
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined)

const headers: Record<string, string> = { "content-type": "application/json" }
if (process.env.AUTH) headers.authorization = process.env.AUTH // e.g. "Basic ..." if the server has a password

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${T}${path}`, { ...init, headers: { ...headers, ...(init?.headers as object) } })
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { ok: res.ok, status: res.status, body }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log(...a)
let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`)
  if (!ok) failures++
  return ok
}

// ---------------------------------------------------------------------------------------------
// Test books
// ---------------------------------------------------------------------------------------------

const EN_BOOK = `Chapter 1 Photosynthesis

Photosynthesis is the process by which green plants convert light energy into chemical energy. It takes place in the chloroplasts, which contain the green pigment chlorophyll. Chlorophyll absorbs sunlight, mostly red and blue light.

During photosynthesis the plant takes in carbon dioxide from the air through small pores called stomata and absorbs water through its roots. Using light energy, the plant turns carbon dioxide and water into glucose and releases oxygen as a by-product.

The overall equation is six molecules of carbon dioxide plus six molecules of water, in the presence of light, give one molecule of glucose and six molecules of oxygen.

Chapter 2 Cell Division

Mitosis is the type of cell division that produces two genetically identical daughter cells. It has four main stages: prophase, metaphase, anaphase and telophase. Before mitosis begins the cell copies its DNA during interphase.

Meiosis is a different kind of cell division that produces four cells with half the number of chromosomes. It is used to make gametes such as sperm and egg cells.

Chapter 3 The Human Heart

The human heart has four chambers: two atria and two ventricles. The right side pumps blood to the lungs to pick up oxygen. The left side pumps oxygen-rich blood around the rest of the body through the aorta.

Valves between the chambers keep blood flowing in one direction. The sound of a heartbeat is made by these valves closing.
`

const AR_BOOK = `الفصل الأول التمثيل الضوئي

التمثيل الضوئي هو العملية التي تحوّل بها النباتات الخضراء الطاقة الضوئية إلى طاقة كيميائية. تحدث هذه العملية في البلاستيدات الخضراء التي تحتوي على صبغة الكلوروفيل. يمتص الكلوروفيل ضوء الشمس.

تأخذ النبتة غاز ثاني أكسيد الكربون من الهواء عبر ثغور صغيرة وتمتص الماء بجذورها. وباستخدام طاقة الضوء تصنع النبتة سكر الغلوكوز وتطلق الأكسجين.

الفصل الثاني الانقسام الخلوي

الانقسام المتساوي هو نوع من الانقسام الخلوي ينتج خليتين متطابقتين وراثيًا. وله أربع مراحل رئيسية هي الطور التمهيدي والطور الاستوائي والطور الانفصالي والطور النهائي.

الانقسام المنصف نوع آخر ينتج أربع خلايا بنصف عدد الكروموسومات، ويُستخدم لتكوين الأمشاج مثل الحيوانات المنوية والبويضات.

الفصل الثالث القلب البشري

يتكون قلب الإنسان من أربع حجرات هي أذينان وبطينان. يضخ الجانب الأيمن الدم إلى الرئتين ليحصل على الأكسجين، ويضخ الجانب الأيسر الدم الغني بالأكسجين إلى باقي الجسم عبر الشريان الأورطي.
`

type Q = { q: string; kind: "in" | "off" | "chat"; lang: "en" | "ar" }
const QUESTIONS: Q[] = [
  { q: "What is photosynthesis?", kind: "in", lang: "en" },
  { q: "Where in the plant cell does photosynthesis happen?", kind: "in", lang: "en" },
  { q: "What gas do plants take in and what do they release?", kind: "in", lang: "en" },
  { q: "Which pigment absorbs sunlight in plants?", kind: "in", lang: "en" },
  { q: "What are the four stages of mitosis?", kind: "in", lang: "en" },
  { q: "How is meiosis different from mitosis?", kind: "in", lang: "en" },
  { q: "How many chambers does the human heart have?", kind: "in", lang: "en" },
  { q: "Why do the heart valves matter?", kind: "in", lang: "en" },
  { q: "Which blood vessel carries blood from the left side of the heart to the body?", kind: "in", lang: "en" },
  { q: "What is the equation of photosynthesis?", kind: "in", lang: "en" },
  { q: "ما هو التمثيل الضوئي؟", kind: "in", lang: "ar" },
  { q: "أين يحدث التمثيل الضوئي في النبات؟", kind: "in", lang: "ar" },
  { q: "ما هي مراحل الانقسام المتساوي؟", kind: "in", lang: "ar" },
  { q: "كم حجرة في قلب الإنسان؟", kind: "in", lang: "ar" },
  { q: "ما الفرق بين الانقسام المتساوي والمنصف؟", kind: "in", lang: "ar" },
  { q: "Who won the football world cup in 2018?", kind: "off", lang: "en" },
  { q: "What is the capital of France?", kind: "off", lang: "en" },
  { q: "How do I fix a flat bicycle tire?", kind: "off", lang: "en" },
  { q: "Write a poem about the ocean.", kind: "off", lang: "en" },
  { q: "What is the best programming language to learn?", kind: "off", lang: "en" },
  { q: "Explain how the stock market works.", kind: "off", lang: "en" },
  { q: "Who is the president of the United States?", kind: "off", lang: "en" },
  { q: "What is the square root of 144?", kind: "off", lang: "en" },
  { q: "من فاز بكأس العالم لكرة القدم؟", kind: "off", lang: "ar" },
  { q: "ما هي عاصمة فرنسا؟", kind: "off", lang: "ar" },
  { q: "كيف أطبخ الأرز؟", kind: "off", lang: "ar" },
  { q: "اكتب لي قصيدة عن البحر", kind: "off", lang: "ar" },
  { q: "hello", kind: "chat", lang: "en" },
  { q: "thanks!", kind: "chat", lang: "en" },
  { q: "مرحبا", kind: "chat", lang: "ar" },
]

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]!
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64")

// ---------------------------------------------------------------------------------------------

const main = async () => {
  log(`Targeted Learning live check against ${BASE}\n`)
  const health = await api("/health")
  if (!check("server reachable and Targeted Learning loaded", health.ok && health.body?.manifestLoaded === true, JSON.stringify(health.body))) return
  check("books.db available", health.body.booksDbAvailable === true)

  // 1. Setup ----------------------------------------------------------------------------------
  const dtype = opt("dtype") ?? "int8"
  if (!flag("skip-setup")) {
    log(`\n-- Setup (dtype ${dtype}); downloading can take several minutes --`)
    const start = await api("/setup/start", { method: "POST", body: JSON.stringify({ dtype }) })
    check("setup started", start.ok, `HTTP ${start.status}`)
    const seen = new Map<string, string>()
    const deadline = Date.now() + 60 * 60 * 1000
    let status: any = null
    while (Date.now() < deadline) {
      status = (await api("/setup")).body
      for (const s of status.steps ?? []) {
        const line = `${s.status}${s.lastError ? ` (${String(s.lastError).slice(0, 200)})` : ""}`
        if (seen.get(s.name) !== line) {
          seen.set(s.name, line)
          log(`   ${s.name.padEnd(18)} ${line}`)
        }
      }
      if (status.status === "ready" || (status.steps ?? []).some((s: any) => s.status === "failed")) break
      await sleep(3000)
    }
    check("setup reached Ready", status?.status === "ready", status?.status)
    if (status?.status !== "ready") return
    const bench = (status.steps ?? []).find((s: any) => s.name === "benchmark")?.result
    if (bench) log(`   benchmark: ${JSON.stringify(bench)}`)
  }

  // 2. Books ----------------------------------------------------------------------------------
  log("\n-- Indexing test books --")
  const bookIds: string[] = []
  for (const [name, text] of [["live-check-en.txt", EN_BOOK], ["live-check-ar.txt", AR_BOOK]] as const) {
    const up = await api("/books", { method: "POST", body: JSON.stringify({ filename: name, contentBase64: b64(text) }) })
    if (!check(`upload ${name}`, up.ok, up.ok ? up.body.slug : `HTTP ${up.status}`)) return
    bookIds.push(up.body.bookId)
  }
  for (const id of bookIds) {
    let row: any
    for (let i = 0; i < 400; i++) {
      row = (await api("/books")).body.books.find((b: any) => b.id === id)
      if (row && (row.status === "ready" || row.status === "failed")) break
      await sleep(1500)
    }
    check(`book ${row?.slug} indexed`, row?.status === "ready", row?.error ?? `${row?.chunkCount} passages`)
  }

  // 3. Scores ---------------------------------------------------------------------------------
  log("\n-- Gate scores (real bge-m3) --")
  const settings = (await api("/settings")).body.values
  const current = Number(settings?.gate?.minDenseScore ?? 0.35)
  const rows: { q: Q; dense: number; decision: string }[] = []
  for (const q of QUESTIONS) {
    const r = await api("/search", { method: "POST", body: JSON.stringify({ query: q.q, bookIds }) })
    if (!r.ok) {
      check(`search "${q.q}"`, false, `HTTP ${r.status}`)
      continue
    }
    rows.push({ q, dense: r.body.bestDenseScore, decision: r.body.decision })
    log(`   ${q.kind.padEnd(4)} ${q.lang}  dense ${r.body.bestDenseScore.toFixed(3)}  ${r.body.decision.padEnd(10)} ${q.q}`)
  }
  const inScores = rows.filter((r) => r.q.kind === "in").map((r) => r.dense)
  const offScores = rows.filter((r) => r.q.kind === "off").map((r) => r.dense)

  // 4. Calibration ----------------------------------------------------------------------------
  const inLow = pct(inScores, 5)
  const offHigh = pct(offScores, 95)
  const separated = inLow > offHigh
  const recommended = Math.round(((inLow + offHigh) / 2) * 100) / 100
  log(`\nin-book   dense: min ${Math.min(...inScores).toFixed(3)}  p5 ${inLow.toFixed(3)}  median ${pct(inScores, 50).toFixed(3)}`)
  log(`off-topic dense: median ${pct(offScores, 50).toFixed(3)}  p95 ${offHigh.toFixed(3)}  max ${Math.max(...offScores).toFixed(3)}`)
  log(`current threshold ${current}; recommended ${recommended}${separated ? "" : "  (the two groups overlap: raise quality, not the threshold)"}`)
  check("in-book questions score above off-topic ones", separated, `p5(in) ${inLow.toFixed(3)} vs p95(off) ${offHigh.toFixed(3)}`)

  const at = (t: number) => ({
    falseRefusals: rows.filter((r) => r.q.kind === "in" && r.dense < t).length,
    falseAccepts: rows.filter((r) => r.q.kind === "off" && r.dense >= t).length,
  })
  const cur = at(current)
  const rec = at(recommended)
  log(`at current ${current}: ${cur.falseRefusals} in-book refused, ${cur.falseAccepts} off-topic accepted`)
  log(`at recommended ${recommended}: ${rec.falseRefusals} in-book refused, ${rec.falseAccepts} off-topic accepted`)
  if (flag("apply") && separated) {
    const patch = await api("/settings", { method: "PATCH", body: JSON.stringify({ gate: { ...(settings.gate ?? {}), minDenseScore: recommended } }) })
    check(`applied gate.minDenseScore = ${recommended}`, patch.ok)
  }

  // 5. Decisions at the (possibly new) threshold ---------------------------------------------
  log("\n-- Gate decisions --")
  const after = flag("apply") && separated ? recommended : current
  for (const q of QUESTIONS) {
    const r = await api("/search", { method: "POST", body: JSON.stringify({ query: q.q, bookIds }) })
    if (!r.ok) continue
    const want = q.kind === "in" ? "pass" : q.kind === "off" ? "refused" : "small-talk"
    check(`${q.kind.padEnd(4)} "${q.q.slice(0, 48)}"`, r.body.decision === want || (q.kind === "chat" && r.body.decision === "pass"), `${r.body.decision} (dense ${r.body.bestDenseScore.toFixed(3)}, threshold ${after})`)
  }

  // 6. Cleanup --------------------------------------------------------------------------------
  if (!flag("keep")) {
    for (const id of bookIds) await api(`/books/${id}`, { method: "DELETE" })
    log("\ntest books removed (use --keep to leave them for a manual chat test)")
  }
  log("\nNext, by hand (needs an LLM provider): add a real book, then in a chat type  @book:<slug> <question>  and an off-topic question.")
}

await main().catch((e) => {
  console.error("live check crashed:", e)
  failures++
})
log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
