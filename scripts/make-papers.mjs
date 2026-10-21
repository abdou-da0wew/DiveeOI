// scripts/make-papers.mjs — two papers about this version of DiveeOI.
//
// The same two documents in two voices and two palettes:
//
//   DiveeOI-field-notes      first person, the story of what broke and why
//   DiveeOI-architecture     the system, written down for someone changing it
//
// Each renders twice: a dark edition (the app's own ground) and a light edition
// (white paper, for a printer). Four PDFs from one source.
//
//   bun scripts/make-papers.mjs
//
// The body type is monospaced on purpose: this is engineering writing, and a
// mono body with a generous leading is easier to read in long paragraphs than
// a proportional face at small sizes.

import { chromium } from "playwright"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(join(root, p)).toString("base64")

const inter = read("packages/app/public/assets/Inter.ttf")
const mono = read("packages/app/public/assets/JetBrainsMonoNerdFontMono-Regular.woff2")
const bebas = read("packages/identity/BebasNeue-Regular.woff2")

// ── palettes ───────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    paper: "#121212",
    ink: "#ededea",
    ink2: "#c3c2bf",
    ink3: "#8a8f98",
    rule: "rgba(237,238,234,0.13)",
    rule2: "rgba(237,238,234,0.07)",
    accent: "#ff5b1f",
    accentSoft: "rgba(255,91,31,0.13)",
    wash: "rgba(255,255,255,0.035)",
    mark: "#ededea",
    cursor: "#ff5b1f",
    chip: "rgba(237,238,234,0.09)",
  },
  light: {
    paper: "#ffffff",
    ink: "#141414",
    ink2: "#3f3f3f",
    ink3: "#6b6b6b",
    rule: "#c9c9c9",
    rule2: "#e6e6e6",
    accent: "#c2410c",
    accentSoft: "#fdf0e9",
    wash: "#fafafa",
    mark: "#141414",
    cursor: "#c2410c",
    chip: "#f0f0f0",
  },
}

// ── the two documents ──────────────────────────────────────────────────────
const FIELD_NOTES = `
<article>
  <h1>The bug that was not a bug</h1>
  <p class="lede">
    A scheduled background task died on every run with
    <code>Service not found: @opencode/Skill</code>. The name said "skill". The fix was
    nothing to do with skills.
  </p>

  <p>
    I had built the background-task system over the previous weeks: a task table, a runner
    that polls two queues, a generator agent that writes a task's spec, hooks, provenance,
    and a UI. The last piece — <em>actually running the task's prompt</em> — failed every
    single time. The task would be picked up, marked running, counted, and then die with
    that one line.
  </p>
  <p>
    I spent an hour on the symptom. I added the skill service to the runner's dependencies.
    It still failed, one service further out: the session memory integration. I added that
    too. Then the formatter. Then ripgrep. Each fix moved the error to the next service in
    the chain, which is exactly what a wrong diagnosis looks like: the error is a symptom,
    and I was treating it as the cause.
  </p>

  <h2>What the error was actually about</h2>
  <p>
    DiveeOI is built on Effect-TS. Every service is a layer, and a layer only ever sees the
    services it declares as dependencies. That is the whole contract, and it is a good one.
  </p>
  <p>
    The task runner was its own layer, so its context was its own declared dependencies —
    a dozen services. The HTTP route handlers, by contrast, ran with the entire application
    context: every service in the app graph, merged. The prompt path needs services
    <em>at call time</em> — the tool registry reads the skill service, the search tools read
    ripgrep, the patch tool reads the formatter — and those requirements propagate outward
    to whoever invoked the call. A route handler could satisfy them. The runner could not.
  </p>
  <p>
    So the runner was calling into a code path that needed forty services while holding
    twelve. The error named whichever service happened to be resolved first.
  </p>

  <h2>The fix</h2>
  <p>
    One place now owns the list of application services. The HTTP graph is built from it, and
    the in-server workers — the task runner and the task generator — depend on it too, so a
    worker has exactly the context a request handler has. One list, two consumers, and the
    class of bug cannot come back.
  </p>
  <p>
    The change was small. The reasoning was the work: I had to understand that
    <code>buildLayer</code> assembles a group by merging its members, that a member's
    implementation is provided with only its own dependencies, and that the fix therefore
    had to give the worker the merged set rather than more individual declarations.
  </p>

  <h2>What else this version fixed</h2>
  <ul>
    <li>
      <strong>Tasks that run, on a schedule, unattended.</strong> The task carries a cron
      expression, an agent, a model, a directory, hooks, and its own session. The runner
      polls; a call journal makes a crash recoverable — committed calls replay verbatim, a
      call that was in flight surfaces as <em>interrupted, verify before retrying</em>.
    </li>
    <li>
      <strong>The generator agent.</strong> Give a task a one-line request and the generator
      writes the whole spec — prompt, schedule, agent, models, hooks — then stops, and the
      task's own agent runs it. The agent drives the same machinery from inside a session,
      through five tools: create, list, status, logs, control.
    </li>
    <li>
      <strong>A router that learns.</strong> DiveeComposer is not a model; it is a router
      that resolves each turn to a free model that is actually reachable. It prefers models
      that recently worked over models that merely look good in the catalogue, and it leaves
      a model alone for a day when it errors or answers with nothing — a ban that is written
      to the database, so a restart does not send the user straight back to it.
    </li>
    <li>
      <strong>An agent that knows what it is.</strong> The system prompt now says DiveeOI,
      in DiveeOI's words, and the built-in configuration skill was rewritten from
      "customize-opencode" to "customize-diveeoi" — because a model that thinks it is
      something else will write the wrong thing.
    </li>
    <li>
      <strong>The film and the brand.</strong> The mark, the wordmark, the palette and the
      motion language are now defined once and shared by the app and the two films, and the
      films' UI is a recreation of the real screens rather than a plausible invention.
    </li>
  </ul>

  <h2>Lessons I keep relearning</h2>
  <ol class="lessons">
    <li><strong>A layer sees only what it declares.</strong> When a service is "not found", ask what the caller holds, not what the message names.</li>
    <li><strong>A truncated error is a hidden error.</strong> The cause was sliced to 500 characters, which cut off every frame that said which service was missing. Raising the slice to 4 000 found the bug in one run.</li>
    <li><strong>The catalogue is a prior, not the truth.</strong> A gateway can list a model as free and then refuse it for want of a key. The router has to learn from refusals, not from the JSON.</li>
    <li><strong>Evidence beats priors.</strong> "It worked ten minutes ago" is worth more than "it is the biggest model available".</li>
    <li><strong>Requirements propagate outward.</strong> A tool that reads a service at call time pushes that requirement onto everyone who calls the tool. Design for it or get bitten by it.</li>
    <li><strong>Make the failure legible.</strong> The same bug, in a test, in a log, and in a UI, costs three different amounts of time to find. The log was the worst of the three.</li>
    <li><strong>Determinism is a feature.</strong> One paused timeline, no clocks, no random: a frame is a pure function of <em>t</em>. That property is what makes a render reproducible and a bug findable.</li>
  </ol>

  <h2>How I fix things in this project</h2>
  <p>
    The pattern is the same every time, and it has five steps.
  </p>
  <ol class="method">
    <li><strong>Name the failure before touching code.</strong> Not "the task is broken" but "the runner holds twelve services and calls a path that needs forty". The second sentence is fixable; the first one is not.</li>
    <li><strong>Get the whole stack.</strong> Then get the <em>shape</em> of it: which frames are mine, which are the runtime's, and what is the first line that mentions something I own.</li>
    <li><strong>Build a way to see it.</strong> For the films it was a probe that reports geometry and opacity at any timestamp; for the server it was a live task and a real run. If you cannot see the thing, the first task is to make it visible.</li>
    <li><strong>Fix the cause, then make the class impossible.</strong> The skill service was a patch. The shared application service set was the fix, and it means the next worker cannot hit the same wall.</li>
    <li><strong>Leave a marker.</strong> The code now carries a comment explaining why the services are shared, and the registry explains why the films are built from sub-compositions. Six months later, that comment is the only thing that will stop the mistake from being made again.</li>
  </ol>
  <h2>What I would do differently</h2>
  <ol class="method">
    <li><strong>Write the failing case down before the fix.</strong> One sentence: "a scheduled task dies with a service-not-found error". I did not have that sentence, which is why I spent the hour on symptoms. The sentence turns a hunt into a reading.</li>
    <li><strong>Keep the whole cause, always.</strong> The 500-character slice I had been reading was cutting off exactly the frames that named the service. It cost ten minutes to raise it and then find the bug in one run. The cheap rule: if an error message ends mid-sentence, the bug is in what you cannot see.</li>
    <li><strong>Ask what the caller holds.</strong> "Service not found" is a statement about the caller's context, not about the service. Reading the layer contract is faster than adding dependencies.</li>
    <li><strong>Make the seam small enough to share.</strong> The application service list is a good seam because it is a list, not a framework. Whenever two things need the same set, that set deserves a name.</li>
    <li><strong>Build the eye first.</strong> Before the film could be judged, it needed something that could describe a frame to me without eyes: geometry, opacity, the transform, the filter. A probe is cheaper than a render and far cheaper than a wrong opinion.</li>
    <li><strong>Write down what the next person will get wrong.</strong> The comment above the shared service list exists so that the next person does not "fix" the runner by adding one more dependency. That comment is worth more than the fix.</li>
  </ol>

  <p class="close">
    The uncomfortable part of this work is that the bug was never about skills. It was
    about architecture, and the architecture was fine — it was just not shared with the
    thing that needed it. That is the shape of most of the bugs I have spent time on here,
    and the fix is almost never more code. It is a smaller distance between two things
    that should have been the same thing all along.
  </p>
</article>
`

const ARCHITECTURE = `
<article>
  <h1>The architecture of a self-hosted coding agent</h1>
  <p class="lede">
    How DiveeOI is put together: one process, one database, a layered service graph, and
    a set of subsystems — sessions, tools, providers, background tasks — that share a
    single application context.
  </p>

  <h2>1 · The deployment shape</h2>
  <p>
    DiveeOI is a Bun process that serves both an HTTP API and the built single-page client.
    The browser is a view; the server owns the sessions, the tools, the permissions and the
    data. There is no second process, no message broker and no external store.
  </p>
  <p>
    The state that matters is a single SQLite file
    (<code>~/.local/share/diveeoi/diveeoi.db</code>, overridable with
    <code>DIVEEOI_DB</code>). Schema changes are migrations, applied on boot, and the
    migration set is the history of the data model. A second runtime — Node — is supported
    for the SQLite bridge, but Bun is the supported path.
  </p>

  <h2>2 · The package map</h2>
  <table>
    <thead><tr><th>Package</th><th>Responsibility</th><th>Scale</th></tr></thead>
    <tbody>
      <tr><td>server</td><td>HTTP surface, sessions, tools, providers, the task subsystem</td><td>343 files, 56 services</td></tr>
      <tr><td>db</td><td>schema, migrations, provider adapters, the session engine</td><td>344 files</td></tr>
      <tr><td>api</td><td>HttpApi group and schema definitions</td><td>20 groups</td></tr>
      <tr><td>app</td><td>the SolidJS client</td><td>Vite; the v2 redesign is in progress</td></tr>
      <tr><td>ui</td><td>the component library</td><td>120 components, 55 of them v2</td></tr>
      <tr><td>llm</td><td>the schema-first provider boundary</td><td>one place that knows about models</td></tr>
      <tr><td>memory</td><td>the project memory graph</td><td>extraction, recall, consolidation</td></tr>
      <tr><td>plugin, plugins</td><td>the plugin SDK and the bundled plugins</td><td>hooks, tools, config</td></tr>
      <tr><td>mcp, identity, sdk</td><td>the MCP host, the brand assets, the clients</td><td>published separately</td></tr>
    </tbody>
  </table>

  <h2>3 · The request path</h2>
  <div class="flow">
browser ── fetch /session/:id/message
  → HttpApi (packages/api, 20 groups)  →  session context + permissions
  → SessionPrompt                    →  the turn loop
  → ToolRegistry                     →  the tools this agent may use
  → tool (read / grep / edit / bash) →  each behind a permission rule
  → Provider                         →  the model, resolved for this turn
  → events                           →  streamed back over SSE
  → SessionProcessor                 →  parts persisted
  → SQLite
  </div>
  <p>
    The provider boundary is the interesting part. A model id is looked up in the catalogue
    at the moment it is needed, not at boot, so a provider can be added, removed or refused
    while the server runs. DiveeComposer — the synthetic model the user picks — resolves to
    a concrete <code>provider/model</code> per turn and carries that model's capabilities,
    so the client's attachment affordances describe the model that will actually answer.
  </p>

  <h2>4 · The service graph</h2>
  <p>
    Every service is an Effect layer. <code>LayerNode.make(layer, deps)</code> declares one
    and the dependency checker verifies the declaration at compile time;
    <code>buildLayer(graph)</code> assembles a graph, with a cycle check at assembly.
  </p>
  <p>
    The HTTP application graph is a single group. The routes, the task runner and the task
    generator all draw their services from it. This matters more than it looks: a service
    that reads another service <em>at call time</em> pushes that requirement onto whoever
    calls it, so a worker that does not share the application context fails at runtime with
    a service-not-found error, however complete its own dependency list is. Sharing one
    list removes that class of failure.
  </p>

  <h2>5 · The data model</h2>
  <p>
    Twenty-six tables. The interesting ones are the two shapes of a conversation: a v1 shape
    (<code>session_message</code>, <code>session_input</code>) and a v2 event shape
    (<code>session_message</code>, <code>session_context_epoch</code>), where the epoch row
    holds the context snapshot a session resumes from. Around them: <code>todo</code>,
    <code>reminder</code>, <code>preference</code>, <code>permission</code>,
    <code>credential</code>, <code>project</code>, <code>session_anchor</code> for the
    lossless memory, and the three task tables.
  </p>

  <h2>6 · The background task subsystem</h2>
  <p>
    A task is a session with a schedule, plus a thin overlay of state: status, heartbeat,
    run count, next run, hook definitions, and provenance — who made it, and which agent.
  </p>
  <ul>
    <li><strong>Two queues.</strong> The runner polls tasks whose cron is due and tasks left <code>queued</code>. Capacity is adaptive, so a slow machine runs fewer tasks at once.</li>
    <li><strong>One prompt path.</strong> A task runs through the same loop an interactive session uses, in the same instance context, with the same permissions.</li>
    <li><strong>A call journal.</strong> Each tool call is written before it executes and marked committed after. A crash replays committed calls and surfaces the interrupted one as a prompt to verify — so a resume never repeats a side effect.</li>
    <li><strong>Hooks.</strong> Triggers (<code>on_complete</code>, <code>on_fail</code>, <code>on_timeout</code>, <code>on_output_match</code>) map to actions (run a command, notify, webhook, create a task). Every dispatch is written to an audit trail.</li>
    <li><strong>A generator.</strong> A task can be handed a one-line request; the generator agent writes the full spec — prompt, schedule, agent, models — and stops. The task's own agent then runs it, unattended.</li>
    <li><strong>Agent-facing tools.</strong> <code>task_create</code>, <code>task_list</code>, <code>task_status</code>, <code>task_logs</code>, <code>task_control</code>, so an agent can manage scheduled work from inside a session and record its own provenance.</li>
  </ul>

  <h2>7 · The model layer</h2>
  <p>
    Providers are adapters behind one interface. A quality classifier scores candidates on
    family, version lineage, variant words and catalogue capabilities; a reachability
    preference favours the bundled free tier, which needs no key; live evidence then
    dominates the prior, because a model that answered minutes ago is worth more than a
    model that merely looks capable. A model that errors, or answers with nothing, is
    benched for a day, and the bench is persisted.
  </p>

  <h2>8 · The extension surface</h2>
  <p>
    Agents, commands, skills, plugins, MCP servers and permissions are all files or
    configuration, discovered at runtime: <code>.opencode/agent/*.md</code>,
    <code>.opencode/command/*.md</code>, <code>SKILL.md</code> folders, plugin modules,
    and MCP server declarations. Permissions are evaluated per tool and per pattern, last
    match wins, and a deny is a deny.
  </p>

  <h2>9 · The media pipeline</h2>
  <p>
    The two films are part of the product's surface, and they are built the same way the
    app is: the brand, the palette and the motion language live in two documents, and
    everything visual is derived from them rather than re-decided per scene.
  </p>
  <p>
    Each film is a HyperFrames project whose root composition holds only timed hosts;
    every scene is its own sub-composition, mounted with
    <code>data-composition-src</code>. That is what makes the timeline in the editor show
    one row per scene instead of a wall of nested divs. A scene's code speaks in absolute
    film time — "the diff lands at 21.0s" — and the build shifts it into the scene's own
    slot, so a scene file never has to know where it sits.
  </p>
  <p>
    The UI in the films is a recreation of the real screens, taken from the source: the
    same theme tokens, the same geometry, the same copy. Two rules keep the renders
    reproducible — one paused timeline per scene, and no clocks or randomness, so a frame
    is a pure function of <em>t</em>.
  </p>

  <h2>10 · Testing</h2>
  <p>
    The suite is layered the way the code is: unit tests beside the module they cover,
    integration tests against a real server and a real database, and the app's own tests
    against the DOM. Fixtures create a temporary project directory, bind it as the active
    instance, and dispose it afterwards, so a test never touches a real workspace.
  </p>
  <p>
    Where a test needs to own a service — a mocked HTTP client, a particular config, a
    fixed clock — it provides that service itself rather than inheriting one. The ambient
    fixture exists for the opposite case: a graph assembled by hand has to supply every
    service its layers transitively require, and a missing one shows up as a
    service-not-found error during construction, which takes the whole file down before the
    first assertion.
  </p>

  <h2>11 · Security posture</h2>
  <ul>
    <li><strong>One password, checked per request.</strong> There are no accounts and no OAuth; the credential lives in the environment or the config, and it is the whole access-control story.</li>
    <li><strong>Permissions are the real boundary.</strong> Every tool call is matched against the ruleset — per tool, per pattern, last match wins — and a deny is a deny. The agent cannot widen its own permissions.</li>
    <li><strong>External paths are gated.</strong> A tool that reaches outside the project asks first, and a rule can refuse a whole class of paths.</li>
    <li><strong>Secrets stay local.</strong> Provider keys are stored in the local database, and only the calls you configure leave the machine.</li>
    <li><strong>The network surface is what you expose.</strong> The server binds what you tell it to; behind a proxy, terminate TLS there. The database file is as sensitive as the code in it.</li>
  </ul>

  <h2>12 · Known limits</h2>
  <ul class="limits">
    <li>The v2 redesign is mid-migration; some surfaces are new components and some are old ones.</li>
    <li>There is no terminal client; the UI is the browser.</li>
    <li>Access is a single shared password — adequate for a machine on a network, not a multi-user identity system.</li>
    <li>SQLite serialises writers; the design assumes one operator.</li>
    <li>The bundled free tier is free and below a frontier model on hard reasoning.</li>
  </ul>
</article>
`

const PAPERS = [
  {
    file: "DiveeOI-field-notes",
    kicker: "Field notes",
    subtitle: "What this version fixed, and what it taught me",
    body: FIELD_NOTES,
  },
  {
    file: "DiveeOI-architecture",
    kicker: "Technical paper",
    subtitle: "The architecture of a self-hosted coding agent",
    body: ARCHITECTURE,
  },
]

// ── layout ─────────────────────────────────────────────────────────────────
const styles = (t) => `
  @font-face { font-family: "Inter"; src: url(data:font/ttf;base64,${inter}) format("truetype"); font-weight: 100 900; font-style: normal; }
  @font-face { font-family: "JetBrains Mono"; src: url(data:font/woff2;base64,${mono}) format("woff2"); font-weight: 100 800; font-style: normal; }
  @font-face { font-family: "Bebas Neue"; src: url(data:font/woff2;base64,${bebas}) format("woff2"); font-weight: 400; font-style: normal; }

  :root {
    --paper: ${t.paper};
    --ink: ${t.ink};
    --ink-2: ${t.ink2};
    --ink-3: ${t.ink3};
    --rule: ${t.rule};
    --rule-2: ${t.rule2};
    --accent: ${t.accent};
    --accent-soft: ${t.accentSoft};
    --wash: ${t.wash};
    --mark: ${t.mark};
    --cursor: ${t.cursor};
    --chip: ${t.chip};
  }

  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: var(--paper);
    color: var(--ink);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 9pt;
    line-height: 1.72;
    letter-spacing: 0.005em;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  .page {
    width: 210mm;
    height: 297mm;
    padding: 18mm 18mm 15mm;
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
    padding-bottom: 5mm;
    border-bottom: 1px solid var(--rule);
  }
  .lockup { display: flex; align-items: center; gap: 3.5mm; }
  .lockup svg { display: block; }
  .wordmark {
    font-family: "Bebas Neue", Impact, "Arial Narrow", sans-serif;
    font-size: 19pt;
    line-height: 1;
    letter-spacing: 0.6px;
    color: var(--ink);
  }
  .wordmark span { color: var(--ink-3); }
  .kicker {
    font-family: "Inter", system-ui, sans-serif;
    font-size: 7.4pt;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  h1 {
    font-family: "Inter", system-ui, sans-serif;
    font-size: 21pt;
    font-weight: 800;
    letter-spacing: -0.028em;
    line-height: 1.14;
    margin: 10mm 0 0;
    color: var(--ink);
  }
  h1 em { font-style: normal; color: var(--accent); }

  h2 {
    font-family: "Inter", system-ui, sans-serif;
    font-size: 10.5pt;
    font-weight: 750;
    letter-spacing: -0.012em;
    line-height: 1.3;
    color: var(--ink);
    margin: 6.5mm 0 2.5mm;
    padding-top: 2.6mm;
    border-top: 1px solid var(--rule-2);
  }
  h2:first-of-type { border-top: none; padding-top: 0; }

  article { max-width: 138mm; }
  article > p, article > ul, article > ol { max-width: 138mm; }
  article > h1, article > h2 { max-width: 158mm; }
  article > table, article > .flow { max-width: 100%; }
  p { color: var(--ink-2); margin: 0 0 2.8mm; }
  p.lede {
    font-size: 10pt;
    line-height: 1.7;
    color: var(--ink-2);
    margin: 4mm 0 0;
    max-width: 165mm;
  }
  p.close { color: var(--ink-3); margin-top: 4mm; }

  strong { color: var(--ink); font-weight: 700; }
  em { font-style: italic; color: var(--ink); }
  code {
    font-family: "JetBrains Mono", monospace;
    font-size: 8.4pt;
    color: var(--ink);
    background: var(--wash);
    border: 1px solid var(--rule-2);
    border-radius: 2px;
    padding: 0.2mm 0.9mm;
    letter-spacing: 0;
    white-space: nowrap;
  }
  a { color: var(--accent); text-decoration: none; }

  ul, ol { margin: 0 0 2.6mm; padding-left: 5mm; }
  li { color: var(--ink-2); margin-bottom: 1.6mm; }
  li::marker { color: var(--accent); }
  ol.lessons li::marker { color: var(--ink-3); font-size: 8.4pt; }
  ol.method li::marker { color: var(--accent); }
  ul.limits li::marker { color: var(--ink-3); }

  .flow {
    font-size: 8.2pt;
    line-height: 1.8;
    color: var(--ink-2);
    background: var(--wash);
    border: 1px solid var(--rule-2);
    border-left: 2px solid var(--accent);
    border-radius: 1.5mm;
    padding: 3mm 3.5mm;
    margin: 0 0 3mm;
    white-space: pre-wrap;
  }
  .flow b { color: var(--ink); font-weight: 700; }

  table { width: 100%; border-collapse: collapse; margin: 0 0 3mm; }
  th {
    font-family: "Inter", system-ui, sans-serif;
    text-align: left;
    font-size: 7.2pt;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-3);
    border-bottom: 1px solid var(--rule);
    padding: 0 2mm 1.4mm 0;
  }
  td {
    font-size: 8.2pt;
    line-height: 1.55;
    color: var(--ink-2);
    border-bottom: 1px solid var(--rule-2);
    padding: 1.5mm 2mm 1.5mm 0;
    vertical-align: top;
  }
  td:first-child { color: var(--ink); font-weight: 700; }

  .foot {
    margin-top: auto;
    padding-top: 4.5mm;
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
    padding: 0.5mm 1.8mm;
    border: 1px solid var(--rule);
    border-radius: 1.2mm;
    font-size: 7pt;
    color: var(--ink-2);
  }
`

const page = (paper, theme, edition) => `
<section class="page">
  <div class="top">
    <div class="lockup">
      <svg width="21" height="21" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12 23V12H32A20 20 0 0 1 32 52H12V41" stroke="${theme.mark}" stroke-width="8" stroke-linecap="butt" fill="none"/>
        <path d="M23 23H32A9 9 0 0 1 32 41H23Z" fill="${theme.cursor}"/>
      </svg>
      <div class="wordmark">DIVEE<span>OI</span></div>
    </div>
    <div class="kicker">${paper.kicker} · ${paper.subtitle}</div>
  </div>
  ${paper.body}
  <div class="foot">
    <span><span class="chip">MIT</span> &nbsp; <span class="chip">self-hosted</span> &nbsp; <span class="chip">${edition} edition</span></span>
    <span class="accent">diveeoi.dev</span>
  </div>
</section>
`

// ── render ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] })

for (const paper of PAPERS) {
  for (const [name, theme] of Object.entries(THEMES)) {
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${paper.subtitle}</title><style>${styles(theme)}</style></head><body>${page(paper, theme, name)}</body></html>`
    const p = await browser.newPage()
    await p.setContent(html, { waitUntil: "load" })
    await p.evaluate(() => document.fonts.ready)

    // Paginate: the article's blocks are measured and distributed over as many
    // pages as they need, each with the same running head and foot.
    const pages = await p.evaluate(() => {
      const first = document.querySelector(".page")
      const article = first.querySelector("article")
      const head = first.querySelector(".top")
      const foot = first.querySelector(".foot")
      const cs = getComputedStyle(first)
      const pageH = first.getBoundingClientRect().height
      const room =
        pageH -
        parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom) -
        head.getBoundingClientRect().height -
        foot.getBoundingClientRect().height -
        12 // the gap between the head and the body, and the body and the foot

      const blocks = Array.from(article.children)
      const groups = []
      let current = []
      let used = 0
      for (const block of blocks) {
        const h = block.getBoundingClientRect().height + parseFloat(getComputedStyle(block).marginBottom || 0)
        if (current.length > 0 && used + h > room) {
          groups.push(current)
          current = []
          used = 0
        }
        current.push(block)
        used += h
      }
      if (current.length > 0) groups.push(current)

      // Rebuild: one .page per group, cloned head and foot.
      const template = first
      template.remove()
      for (const group of groups) {
        const page = template.cloneNode(false)
        page.appendChild(head.cloneNode(true))
        const art = document.createElement("article")
        for (const block of group) art.appendChild(block)
        page.appendChild(art)
        page.appendChild(foot.cloneNode(true))
        document.body.appendChild(page)
      }
      return groups.length
    })

    // A PNG of every page, for checking the layout without a PDF reader.
    if (process.env.PAPER_PREVIEW) {
      const shots = await p.$$(".page")
      for (let i = 0; i < shots.length; i++) {
        await shots[i].screenshot({ path: join(root, `.paper-preview-${paper.file}-${name}-${i + 1}.png`) })
      }
    }

    const out = join(root, `${paper.file}-${name}.pdf`)
    await p.pdf({
      path: out,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    })
    await p.close()
    console.log(`wrote ${out}  (${pages} pages)`)
  }
}

await browser.close()
