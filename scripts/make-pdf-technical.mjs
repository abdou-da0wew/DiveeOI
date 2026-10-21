// scripts/make-pdf-technical.mjs — the print-ready technical brief.
//
// A second PDF: white ground, black ink, a print-safe accent. It is the same
// product, described for engineers — the package map, the request path, the
// service graph, the data model, the extension points, and the gaps.
//
//   bun scripts/make-pdf-technical.mjs [out.pdf]

import { chromium } from "playwright"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const out = resolve(process.argv[2] ?? join(root, "DiveeOI-technical.pdf"))

const read = (p) => readFileSync(join(root, p)).toString("base64")
const inter = read("packages/app/public/assets/Inter.ttf")
const mono = read("packages/app/public/assets/JetBrainsMonoNerdFontMono-Regular.woff2")
const bebas = read("packages/identity/BebasNeue-Regular.woff2")

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DiveeOI — technical brief</title>
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

  /* Print palette: white ground, black ink, one darkened accent.
     #FF5B1F is a screen colour; at #C2410C it survives a greyscale printer
     and a bad laser. Nothing here depends on colour to be understood. */
  :root {
    --paper: #ffffff;
    --ink: #141414;
    --ink-2: #3f3f3f;
    --ink-3: #6b6b6b;
    --rule: #c9c9c9;
    --rule-soft: #e4e4e4;
    --accent: #c2410c;
    --accent-wash: #fdf0e9;
  }

  @page { size: A4; margin: 0; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: var(--paper);
    color: var(--ink);
    font-family: "Inter", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  .page {
    width: 210mm;
    height: 297mm;
    padding: 16mm 16mm 13mm;
    page-break-after: always;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 4.5mm;
    border-bottom: 1px solid var(--rule);
  }
  .lockup { display: flex; align-items: center; gap: 3.5mm; }
  .lockup svg { display: block; }
  .wordmark {
    font-family: "Bebas Neue", Impact, "Arial Narrow", sans-serif;
    font-size: 19pt;
    line-height: 1;
    letter-spacing: 0.5px;
    color: var(--ink);
  }
  .wordmark span { color: var(--ink-3); }
  .tag { font-size: 7.5pt; color: var(--ink-3); letter-spacing: 0.08em; text-transform: uppercase; }

  h1 { font-size: 22pt; font-weight: 800; letter-spacing: -0.03em; line-height: 1.08; margin: 8mm 0 0; }
  h1 em { font-style: normal; color: var(--accent); }
  h2 { font-size: 11pt; font-weight: 750; letter-spacing: -0.015em; margin: 0 0 2.5mm; }
  h3 {
    font-size: 8.5pt;
    font-weight: 750;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 2mm;
  }
  .lede { font-size: 10.5pt; line-height: 1.45; color: var(--ink-2); margin: 3mm 0 0; max-width: 160mm; }
  p { font-size: 8.8pt; line-height: 1.5; color: var(--ink-2); }
  strong { color: var(--ink); font-weight: 650; }
  .mono { font-family: "JetBrains Mono", monospace; font-size: 7.8pt; color: var(--ink); }

  .rule { height: 1px; background: var(--rule); margin: 5mm 0; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm 8mm; }
  .col3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm 6mm; }

  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    font-size: 7.4pt;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-3);
    border-bottom: 1px solid var(--rule);
    padding: 0 2mm 1.4mm 0;
  }
  td {
    font-size: 8.2pt;
    line-height: 1.4;
    color: var(--ink-2);
    border-bottom: 1px solid var(--rule-soft);
    padding: 1.5mm 2mm 1.5mm 0;
    vertical-align: top;
  }
  td:first-child { color: var(--ink); font-weight: 600; }
  td .mono { font-size: 7.4pt; }

  ol.steps, ul.bullets { list-style: none; }
  ol.steps li, ul.bullets li {
    position: relative;
    padding-left: 4mm;
    margin-bottom: 1.9mm;
    font-size: 8.6pt;
    line-height: 1.45;
    color: var(--ink-2);
  }
  ol.steps li::before {
    content: counter(step);
    counter-increment: step;
    position: absolute;
    left: -6.5mm;
    top: 0.3mm;
    width: 5mm;
    height: 5mm;
    border-radius: 1.4mm;
    background: var(--accent-wash);
    color: var(--accent);
    font-size: 7.4pt;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  ol.steps { counter-reset: step; }
  ul.bullets li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 1.5mm;
    width: 1.4mm;
    height: 1.4mm;
    border-radius: 50%;
    background: var(--accent);
  }
  ol.steps b, ul.bullets b { color: var(--ink); font-weight: 650; }

  .flow {
    font-family: "JetBrains Mono", monospace;
    font-size: 7.6pt;
    line-height: 1.7;
    color: var(--ink-2);
    background: #fafafa;
    border: 1px solid var(--rule-soft);
    border-radius: 2mm;
    padding: 3mm 3.5mm;
  }
  .flow b { color: var(--ink); font-weight: 700; }

  .foot {
    margin-top: auto;
    padding-top: 4mm;
    border-top: 1px solid var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7.2pt;
    color: var(--ink-3);
  }
  .foot .accent { color: var(--accent); }
  .chip {
    display: inline-block;
    padding: 0.6mm 1.8mm;
    border: 1px solid var(--rule);
    border-radius: 1.2mm;
    font-size: 7pt;
    font-weight: 650;
    color: var(--ink-2);
  }
</style>
</head>
<body>

<!-- ───────────────────────── page 1 ───────────────────────── -->
<section class="page">
  <div class="top">
    <div class="lockup">
      <svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12 23V12H32A20 20 0 0 1 32 52H12V41" stroke="#141414" stroke-width="8" stroke-linecap="butt" fill="none"/>
        <path d="M23 23H32A9 9 0 0 1 32 41H23Z" fill="#C2410C"/>
      </svg>
      <div class="wordmark">DIVEE<span>OI</span></div>
    </div>
    <div class="tag">Technical brief · self-hosted</div>
  </div>

  <h1>The system, for people who will<br /><em>change</em> it.</h1>
  <p class="lede">
    One Bun process, one SQLite file, one SolidJS client. The server owns the sessions, the
    tools, the permissions and the data; the browser is a view. This is the map, the request
    path, the extension points, and the gaps.
  </p>

  <div class="rule"></div>

  <h2>The request path</h2>
  <div class="flow">
<b>browser</b> → fetch /session/:id/message
  → <b>HttpApi</b> (20 groups, packages/api) → <b>SessionPrompt</b>
  → <b>ToolRegistry</b> (one registry per session) → <b>tool</b> (read/grep/edit/bash/…)
  → <b>Provider</b> → <b>model</b> → events back over SSE
  → <b>SessionProcessor</b> persists parts → <b>SQLite</b>
  </div>

  <div class="rule"></div>

  <div class="grid2">
    <div>
      <h3>Layers, not a container</h3>
      <p>
        Every service is an Effect layer. <span class="mono">LayerNode.make(layer, deps)</span>
        declares one, and <span class="mono">buildLayer(graph)</span> assembles the graph
        with a cycle check. 56 services live in the server package; the HTTP application
        graph is a single group that the routes, the task runner and the task generator all
        share — so an in-server worker has exactly the context a request handler has.
      </p>
      <p>
        Providers are resolved per turn, not per process: a model id is looked up in the
        catalog, and <strong>DiveeComposer</strong> resolves to the concrete
        <span class="mono">provider/model</span> it routed to. The synthetic model carries
        the target's capabilities, so the UI's attachment buttons match the model that
        actually answers.
      </p>
    </div>
    <div>
      <h3>Data</h3>
      <p>
        26 tables, 46 migrations, one file. Sessions and messages exist twice — a v1
        shape (<span class="mono">session_message</span>,
        <span class="mono">session_input</span>) and a v2 event shape
        (<span class="mono">session_message</span>,
        <span class="mono">session_context_epoch</span>) — with the v2 epoch table holding
        the context snapshot a session resumes from. Tasks add three:
        <span class="mono">agent_task</span>, a call journal
        (<span class="mono">agent_task_call</span>) and a hook audit trail
        (<span class="mono">agent_task_event</span>).
      </p>
    </div>
  </div>

  <div class="rule"></div>

  <h2>The packages</h2>
  <table>
    <thead>
      <tr><th style="width:26%">Package</th><th style="width:34%">Holds</th><th>Notes</th></tr>
    </thead>
    <tbody>
      <tr><td>server</td><td>HTTP, sessions, tools, providers</td><td>343 files, 56 services</td></tr>
      <tr><td>db</td><td>schema, migrations, providers, engine</td><td>344 files; the SQLite bridge</td></tr>
      <tr><td>api</td><td>HttpApi definitions</td><td>20 groups; schemas are the contract</td></tr>
      <tr><td>app</td><td>the SolidJS client</td><td>Vite; the v2 redesign is in progress</td></tr>
      <tr><td>ui</td><td>the component library</td><td>120 components, 55 of them v2</td></tr>
      <tr><td>llm</td><td>Schema-first LLM client</td><td>the provider boundary</td></tr>
      <tr><td>plugin / plugins</td><td>the plugin SDK and bundled plugins</td><td>hooks, tools, config</td></tr>
      <tr><td>memory / mcp / identity / sdk</td><td>the rest</td><td>graph memory, MCP host, brand, clients</td></tr>
    </tbody>
  </table>

  <div class="foot">
    <span>TypeScript 5.8 · Bun 1.3.14 · Effect-TS 4.0.0-beta.74 · SolidJS 1.9 · Drizzle 1.0-rc · SQLite · Tailwind 4.1</span>
    <span class="accent">MIT · <span class="mono">diveeoi.dev</span></span>
  </div>
</section>

<!-- ───────────────────────── page 2 ───────────────────────── -->
<section class="page">
  <div class="top">
    <div class="lockup">
      <svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12 23V12H32A20 20 0 0 1 32 52H12V41" stroke="#141414" stroke-width="8" stroke-linecap="butt" fill="none"/>
        <path d="M23 23H32A9 9 0 0 1 32 41H23Z" fill="#C2410C"/>
      </svg>
      <div class="wordmark">DIVEE<span>OI</span></div>
    </div>
    <div class="tag">Running it · extending it · the gaps</div>
  </div>

  <h1 style="font-size:19pt;margin-top:7mm">Running it, extending it, and the gaps.</h1>

  <div class="rule" style="margin-top:4mm"></div>

  <div class="grid2">
    <div>
      <h3>Running it</h3>
      <ul class="bullets">
        <li><b>One process.</b> <span class="mono">bun run dev:both</span> starts the server
          (<span class="mono">:4097</span>) and the client. The server serves the built UI too.</li>
        <li><b>Config precedence</b> is global → project → environment. The file is
          <span class="mono">diveeoi.json</span> (or
          <span class="mono">opencode.json</span>); both names are read, and the
          <span class="mono">diveeoi</span> name wins.</li>
        <li><b>The database</b> defaults to
          <span class="mono">~/.local/share/diveeoi/diveeoi.db</span>; override with
          <span class="mono">DIVEEOI_DB</span>. Migrations apply on boot.</li>
        <li><b>Auth is a password</b>, served by the server and checked per request. No
          OAuth, no accounts.</li>
        <li><b>Tests:</b> 2 688 server, 415 client, 930 database. Typecheck per package with
          <span class="mono">tsgo</span>.</li>
      </ul>

      <h3 style="margin-top:4mm">Background tasks</h3>
      <p>
        A task is a session with a schedule. The runner polls two queues — tasks whose cron
        is due, and tasks left <span class="mono">queued</span> — runs them through the same
        prompt path an interactive session uses, and records the outcome. A call journal makes
        a crash recoverable: committed calls are replayed verbatim, a call that was in flight
        is surfaced as “interrupted, verify before retrying”.
      </p>
      <p>
        The agent drives them too, through <span class="mono">task_create</span>,
        <span class="mono">task_list</span>, <span class="mono">task_status</span>,
        <span class="mono">task_logs</span> and <span class="mono">task_control</span>. A task
        can ask the generator agent to write its own spec first — prompt, schedule, agent,
        models — and then runs unattended.
      </p>
    </div>

    <div>
      <h3>Extension points</h3>
      <ul class="bullets">
        <li><b>Agents</b> — <span class="mono">.opencode/agent/*.md</span> with frontmatter
          (model, mode, permission, tools).</li>
        <li><b>Commands</b> — <span class="mono">.opencode/command/*.md</span>, with
          <span class="mono">$ARGUMENTS</span> and <span class="mono">$1</span>.</li>
        <li><b>Skills</b> — <span class="mono">SKILL.md</span> folders, frontmatter with a
          name and a trigger description.</li>
        <li><b>Plugins</b> — a <span class="mono">Plugin</span> export; hooks for config,
          events, tool execution, permissions.</li>
        <li><b>MCP servers</b> — local or remote, declared in config; their tools join the
          registry.</li>
        <li><b>Permissions</b> — per tool and per pattern, evaluated last-match-wins.</li>
      </ul>
      <h3 style="margin-top:4mm">The gaps, with their cost</h3>
      <table>
        <thead><tr><th style="width:42%">Gap</th><th>What it means</th></tr></thead>
        <tbody>
          <tr><td>v2 redesign mid-migration</td><td>some surfaces are new components, some are the old ones</td></tr>
          <tr><td>No TUI</td><td>browser only; there is no terminal client</td></tr>
          <tr><td>One shared password</td><td>fine on a LAN, not a multi-user identity system</td></tr>
          <tr><td>No built-in TLS</td><td>terminate at your own proxy; protect the DB file</td></tr>
          <tr><td>SQLite concurrency</td><td>one writer at a time; fine for one operator</td></tr>
          <tr><td>Free-model ceiling</td><td>the bundled tier is free and below a frontier model at hard reasoning</td></tr>
          <tr><td>Model churn</td><td>the free tier moves; a model that fails is benched for a day</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="foot">
    <span><span class="chip">MIT</span> &nbsp; <span class="chip">self-hosted</span> &nbsp; <span class="chip">no telemetry</span></span>
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
