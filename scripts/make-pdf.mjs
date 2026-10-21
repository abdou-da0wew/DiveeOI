// scripts/make-pdf.mjs — render the two-page DiveeOI brief to PDF.
//
// HTML → Chrome → PDF. The page is authored for print: A4, two pages, the brand
// palette (charcoal ground, off-white ink, steel grey, safety orange), the
// real mark and the real wordmark face.
//
//   bun scripts/make-pdf.mjs [out.pdf]

import { chromium } from "playwright"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const out = resolve(process.argv[2] ?? join(root, "DiveeOI.pdf"))

const read = (p) => readFileSync(join(root, p)).toString("base64")

// The fonts are the product's own: Inter for the app's UI face, JetBrains Mono
// for the technical lines, and the vendored Bebas Neue for the wordmark.
const inter = read("packages/app/public/assets/Inter.ttf")
const mono = read("packages/app/public/assets/JetBrainsMonoNerdFontMono-Regular.woff2")
const bebas = read("packages/identity/BebasNeue-Regular.woff2")

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DiveeOI — what it is, how it works, and where it stops</title>
<style>
  @font-face {
    font-family: "Inter";
    src: url(data:font/ttf;base64,${inter}) format("truetype");
    font-weight: 100 900;
    font-style: normal;
  }
  @font-face {
    font-family: "JetBrains Mono";
    src: url(data:font/woff2;base64,${mono}) format("woff2");
    font-weight: 100 800;
    font-style: normal;
  }
  @font-face {
    font-family: "Bebas Neue";
    src: url(data:font/woff2;base64,${bebas}) format("woff2");
    font-weight: 400;
    font-style: normal;
  }

  :root {
    --charcoal: #121212;
    --ink: #ededea;
    --steel: #8a8f98;
    --accent: #ff5b1f;
    --accent-soft: rgba(255, 91, 31, 0.13);
    --line: rgba(237, 238, 234, 0.11);
  }

  @page { size: A4; margin: 0; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: var(--charcoal);
    color: var(--ink);
    font-family: "Inter", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  .page {
    width: 210mm;
    height: 297mm;
    padding: 17mm 17mm 14mm;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    display: flex;
    flex-direction: column;
  }
  .page:last-child { page-break-after: auto; }

  /* ── the lockup: the real mark and the real wordmark ── */
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 5.5mm;
    border-bottom: 1px solid var(--line);
  }
  .lockup { display: flex; align-items: center; gap: 4mm; }
  .lockup svg { display: block; }
  .wordmark {
    font-family: "Bebas Neue", Impact, "Arial Narrow", sans-serif;
    font-size: 21pt;
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.5px;
    color: var(--ink);
  }
  .wordmark span { color: var(--steel); }
  .tag { font-size: 8pt; color: var(--steel); letter-spacing: 0.08em; text-transform: uppercase; }

  /* ── type ── */
  h1 {
    font-size: 29pt;
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.06;
    margin: 11mm 0 0;
  }
  h1 em { font-style: normal; color: var(--accent); }
  h2 { font-size: 12.5pt; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 3.5mm; }
  h3 {
    font-size: 9.5pt;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 2.5mm;
  }
  .lede {
    font-size: 11.5pt;
    line-height: 1.45;
    color: var(--steel);
    margin: 3.5mm 0 0;
    max-width: 152mm;
  }
  p { font-size: 9.5pt; line-height: 1.55; color: #c8c7c4; }
  strong { color: var(--ink); font-weight: 650; }
  .mono { font-family: "JetBrains Mono", monospace; font-size: 8.4pt; color: var(--ink); }

  .rule { height: 1px; background: var(--line); margin: 6.5mm 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 9mm; }
  .card { border-top: 1px solid var(--line); padding-top: 3mm; }
  .card p { font-size: 9pt; line-height: 1.5; }

  ol.steps { list-style: none; counter-reset: step; }
  ol.steps li {
    counter-increment: step;
    position: relative;
    padding-left: 11mm;
    margin-bottom: 3.4mm;
    font-size: 9.5pt;
    line-height: 1.5;
    color: #c8c7c4;
  }
  ol.steps li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: 0.2mm;
    width: 6.4mm;
    height: 6.4mm;
    border-radius: 2mm;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 8pt;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  ol.steps b { color: var(--ink); font-weight: 650; }

  ul.limits { list-style: none; }
  ul.limits li {
    position: relative;
    padding-left: 4.2mm;
    margin-bottom: 2.1mm;
    font-size: 8.8pt;
    line-height: 1.45;
    color: #c8c7c4;
  }
  ul.limits li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 1.5mm;
    width: 1.6mm;
    height: 1.6mm;
    border-radius: 50%;
    background: var(--accent);
  }
  ul.limits b { color: var(--ink); font-weight: 650; }

  .foot {
    margin-top: auto;
    padding-top: 5mm;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7.5pt;
    color: var(--steel);
  }
  .foot .accent { color: var(--accent); }

  .pill {
    display: inline-block;
    padding: 0.7mm 2.2mm;
    border-radius: 1.4mm;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 7.5pt;
    font-weight: 650;
    letter-spacing: 0.02em;
  }
</style>
</head>
<body>

<!-- ───────────────────────── page 1 ───────────────────────── -->
<section class="page">
  <div class="top">
    <div class="lockup">
      <svg width="26" height="26" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12 23V12H32A20 20 0 0 1 32 52H12V41" stroke="#EDEDEA" stroke-width="8" stroke-linecap="butt" fill="none"/>
        <path d="M23 23H32A9 9 0 0 1 32 41H23Z" fill="#FF5B1F"/>
      </svg>
      <div class="wordmark">DIVEE<span>OI</span></div>
    </div>
    <div class="tag">Self-hosted AI coding agent</div>
  </div>

  <h1>An AI agent that works<br />on your code, <em>on your machine</em>.</h1>
  <p class="lede">
    DiveeOI is a web app where AI agents read, write, run and remember inside your own
    projects. One process, one SQLite file, your machine. The only thing that leaves it is
    the model traffic you choose to send.
  </p>

  <div class="rule"></div>

  <div class="grid2">
    <div>
      <h3>What it is</h3>
      <p>
        A SolidJS web app in front of an Effect-TS server. You open a project directory and
        talk to an agent in a chat: it <strong>explores your codebase</strong>, writes and
        edits files, runs your tests and linters, searches the web when you ask it to, uses
        any MCP server you connect, and keeps a memory of your project between sessions.
      </p>
    </div>
    <div>
      <h3>What is not it</h3>
      <p>
        Not a cloud IDE, not a model provider, not a place your code is hosted. There is no
        account to create and no subscription. You bring the machine; the app brings the
        agent, the tools, the diffs and the history.
      </p>
    </div>
  </div>

  <div class="rule"></div>

  <h2>How it works</h2>
  <ol class="steps">
    <li><b>Point it at a project.</b> The server reads that directory and nothing else.</li>
    <li><b>Write a sentence.</b> “Fix the flaky session test”, “add a migration for the new column”, “summarise my open pull requests”. No commands, no syntax.</li>
    <li><b>The agent works through tools</b> — read, grep, glob, edit, write, bash — each one behind a permission rule you set, and each one visible in the transcript as it happens.</li>
    <li><b>Changes arrive as a diff.</b> Nothing is applied behind your back: you read the
      added and removed lines and accept or discard them.</li>
    <li><b>Or let it run on its own.</b> A background task is a session with a schedule: it
      re-runs on a cron expression, with its own agent, its own model, and its own log.</li>
  </ol>

  <div class="rule"></div>

  <div class="grid2">
    <div class="card">
      <h3>The model is yours</h3>
      <p>
        <strong>DiveeComposer</strong> is a router, not a model: it resolves every turn to
        the best free model that is actually reachable right now, and remembers which models
        answer. A model that fails is left alone for a day. Bring your own key for anything
        else — Anthropic, OpenAI, Google, OpenRouter, Ollama on your own box.
      </p>
    </div>
    <div class="card">
      <h3>The shape of it</h3>
      <p>
        <span class="mono">bun run dev:both</span> starts the server and the app. The
        browser is just a client: the server owns the sessions, the tools, the permissions
        and the database. Behind a proxy, on your LAN, or over SSH — the same build.
      </p>
    </div>
  </div>

  <div class="foot">
    <span>TypeScript 5.8 · Bun 1.3 · Effect-TS 4.0 · SolidJS 1.9 · Drizzle + SQLite · Tailwind 4.1</span>
    <span class="accent">MIT · self-hosted · <span class="mono">diveeoi.dev</span></span>
  </div>
</section>

<!-- ───────────────────────── page 2 ───────────────────────── -->
<section class="page">
  <div class="top">
    <div class="lockup">
      <svg width="26" height="26" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12 23V12H32A20 20 0 0 1 32 52H12V41" stroke="#EDEDEA" stroke-width="8" stroke-linecap="butt" fill="none"/>
        <path d="M23 23H32A9 9 0 0 1 32 41H23Z" fill="#FF5B1F"/>
      </svg>
      <div class="wordmark">DIVEE<span>OI</span></div>
    </div>
    <div class="tag">Where it stops</div>
  </div>

  <h1 style="font-size:25pt">The limits, stated plainly.</h1>
  <p class="lede" style="margin-top:3mm">
    A self-hosted agent is a different bargain from a hosted one. Here is what you are
    actually getting, and where it stops.
  </p>

  <div class="rule"></div>

  <div class="grid2">
    <div>
      <h3>The model</h3>
      <ul class="limits">
        <li><b>Free models are free models.</b> The bundled free tier is genuinely free and genuinely good enough to work with — and genuinely below a frontier model on hard reasoning. The app does not pretend otherwise.</li>
        <li><b>The free tier moves.</b> Models are added and retired. The router re-resolves every turn, and a model that errors or answers with nothing is not used again for a day.</li>
        <li><b>Reachability is not a given.</b> “Free” in the catalogue may still need a key. The router prefers what is actually reachable — which is why the bundled tier is the one it picks.</li>
        <li><b>Your key, your bill.</b> Point it at your own provider and the cost, the rate limits and the data path are yours.</li>
      </ul>
    </div>
    <div>
      <h3>The agent</h3>
      <ul class="limits">
        <li><b>It can be confidently wrong.</b> It writes code the way a good junior engineer writes code: fast, plausible, occasionally wrong. The diff is the safety net — read it.</li>
        <li><b>It only knows what you give it.</b> It searches as it goes rather than holding an index of your whole repository. Ask it to look, and it looks.</li>
        <li><b>Permissions are the real control.</b> Per tool, per pattern: “allow <span class="mono">git *</span>”, “deny <span class="mono">rm *</span>”, “ask on <span class="mono">external_directory</span>”. A deny is a deny.</li>
        <li><b>Background tasks are still agents.</b> A scheduled task runs unattended with the permissions it has. Give one the power to push, and it will push unattended.</li>
      </ul>
    </div>
  </div>

  <div class="rule"></div>

  <div class="grid2">
    <div>
      <h3>The product, today</h3>
      <ul class="limits">
        <li><b>Early.</b> The v2 redesign is mid-migration: some surfaces are the new components, some are still the old ones. The app is usable and improving, not finished.</li>
        <li><b>Web only.</b> The terminal UI was removed on purpose. Everything happens in the browser.</li>
        <li><b>One password.</b> Access is a single shared password — enough for a machine on your network, not a multi-user identity system. Put it behind your own proxy for anything more.</li>
        <li><b>No built-in TLS.</b> Terminate it at nginx or Caddy. Sessions live in your SQLite file, so protect the file, not just the URL.</li>
      </ul>
    </div>
    <div>
      <h3>Operating it</h3>
      <ul class="limits">
        <li><b>One SQLite file is the source of truth.</b> Sessions, messages, tasks and memory live in it. Back it up like you back up your code.</li>
        <li><b>A restart is safe.</b> Tasks that were running when the process died are picked back up: stale ones are marked interrupted, and a task's call journal is replayed instead of repeated.</li>
        <li><b>Remote sessions run remotely.</b> Over SSH the agent works on the remote machine; <span class="mono">ctx_local</span> runs a single tool call back on your laptop.</li>
        <li><b>Nothing is required from us.</b> No telemetry, no account, no sync. If you turn on crash reporting, it goes where you pointed it.</li>
      </ul>
    </div>
  </div>

  <div class="foot">
    <span><span class="pill">v2 redesign in progress</span> &nbsp; <span class="pill">web only</span> &nbsp; <span class="pill">single-user</span></span>
    <span class="accent">diveeoi.dev · github.com/abdou-da0wew/DiveeOI</span>
  </div>
</section>

</body>
</html>`

const browser = await chromium.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] })
const page = await browser.newPage()
await page.setContent(html, { waitUntil: "load" })
await page.evaluate(() => document.fonts.ready)
await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
})
await browser.close()
console.log(`wrote ${out}`)
