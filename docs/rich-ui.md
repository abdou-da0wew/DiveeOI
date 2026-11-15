# Rich UI protocol

DiveeOI rich chat interfaces are agent-authored declarative component trees. The model chooses the structure for the current task; the renderer does not select from a fixed gallery of templates.

## Runtime contract

- `create_ui` accepts a versioned `ChatUISpec`, validates it on the server, and emits the validated spec as tool metadata.
- `RichUIRenderer` renders the specification with statically bundled SolidJS components. It never evaluates model-authored JavaScript, HTML, CSS, JSX, or arbitrary expression source. Numeric calculations use only the separately validated, depth-bounded expression tree.
- A spec contains a title, optional description, `stack` or `grid` root layout, optional initial state, and up to 24 top-level components.
- Nested groups, tabs, and conditionals are supported up to four levels deep and 64 total components. Each nested component array is independently bounded.
- State is local to the rendered component instance by default. A spec may opt into `persistState: true`; the client then restores only declared, type-compatible primitive values from browser-profile storage, scoped by session ID and UI ID. This is not a secret store or cross-device database.
- A button may include `submit` or `refresh`. Both hand the current state back into the same conversation as untrusted user-provided data. `submit` can also attach selected files. `refresh` asks the agent to produce refreshed output; it is not a live network poll.

## Composition primitives

| Component     | Purpose                                                                 | Interaction                                                                                          |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `group`       | Nested `stack`, `row`, or `grid` layout                                 | Children share the spec state                                                                        |
| `tabs`        | Switch between labeled panels                                           | Optional declared state key keeps the selected tab synchronized                                      |
| `conditional` | Show children when a state key equals a typed value                     | Reacts to shared state                                                                               |
| `field`       | Text, number, toggle, or select control                                 | Updates declared state; text/number fields support required, min/max, length, pattern, and help text |
| `file-upload` | Select supported user files                                             | Adds selected files to the next form submission                                                      |
| `state-value` | Display a state value                                                   | Updates reactively                                                                                   |
| `computed`    | Derive a numeric value from shared state with a bounded expression tree | Recalculates reactively                                                                              |
| `button`      | Action surface                                                          | Runs bounded local actions or hands state to the active conversation                                 |

The root `state` array declares unique `{ key, value }` entries. Fields, values, conditions, grids, uploads, tabs, and button actions must reference declared keys. The parser verifies types, unique component IDs, select membership, and action compatibility.

Button local actions are restricted to:

- `set`: replace a value without changing its type.
- `toggle`: invert a boolean.
- `increment`: add a bounded numeric delta to a numeric value.
- `filter`: update a declared primitive state key with a same-typed value.
- `navigate`: set a declared tab-state key to one of the tabs declared in the component.
- `submit`: hand off current state and selected files to the current conversation.
- `refresh`: hand off current state to the agent and request updated output.

There are no arbitrary event handlers, code strings, network callbacks, DOM selectors, or dynamic imports.

## File attachments, grids, maps, and media

`file-upload` accepts a bounded allowlist of PNG/JPEG/WebP/GIF images, PDF, plain text, Markdown, CSV, and JSON. A UI can select at most five files, each no larger than the control's configured size (default 8 MB, maximum 12 MB), with a combined submission limit of 20 MB. Selecting a file does not upload it; the file is attached only when a form submit or refresh action is used. File bytes are ephemeral and are not restored by `persistState`.

`data-grid` supports typed text/number columns, bounded row counts, and optional row editing. Edited rows are serialized as JSON in the component's declared string state (up to 48 KB, with 100-character text cells) and are included in a form submission. Grid strings are bounded separately from ordinary text fields and are not treated as executable data.

`map` validates latitude/longitude ranges and marker identity. The component displays a simple coordinate preview and a link to OpenStreetMap. It does not embed live basemap tiles or claim to provide a full GIS layer. `media` supports image, video, and audio with HTTPS URLs on public hostnames; credentials, IP-literal hosts, localhost, and common local-network hostnames are rejected.

## Form submission and authorized actions

`submit` and `refresh` are conversation handoffs, not privileged HTTP or database callbacks. The app validates the current session, bounded primitive values, selected-file MIME/size/count, then attaches files to the active conversation. Submitted JSON is explicitly marked untrusted. The active agent continues the task with its available tools and ordinary permission checks. If a task requires a real API, database, file, or external operation, the agent must use an existing authorized tool, integration, or MCP connection. A form click never grants extra access and cannot inject an arbitrary URL, SQL statement, shell command, or tool name into a privileged executor.

`persistState: true` is opt-in and saves only declared primitive state in the browser profile, namespaced by session and UI ID. Restoration ignores undeclared keys, type changes, oversized strings, and non-finite numbers. Do not place passwords, API keys, session cookies, or other secrets in Rich UI state. This storage is local to the browser profile and is not a secure vault or server-side shared record.

## Display and simulation components

The basic display set includes `heading`, `text`, `metric`, `callout`, `progress`, `chart`, and `table`. `simulation` provides bounded sliders, toggles, selects, and a numeric expression tree. Expressions are depth-limited and can reference only declared simulation controls.

## Specialized interactive components

| Component   | Built-in behavior                                     | Explicit limitation                                           |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `workflow`  | Select nodes, add a local node, run a local preview   | Does not call an external workflow engine                     |
| `desktop`   | Switch between simulated app windows                  | Not an actual operating-system session                        |
| `database`  | Inspect selectable sample records                     | No database connection or writes                              |
| `api`       | Edit method/endpoint and reveal a sample response     | No HTTP request is sent                                       |
| `scene`     | Rotate an SVG cube, sphere, or pyramid                | Not a WebGL/Three.js scene                                    |
| `wizard`    | Navigate multi-step local form state                  | No independent persistence endpoint                           |
| `monitor`   | Pause/resume and refresh displayed metrics            | Sample values are not host telemetry                          |
| `circuit`   | Adjust voltage/resistance and calculate current/power | Ideal DC circuit model only                                   |
| `map`       | Inspect marker coordinates and open OpenStreetMap     | Coordinate preview, not embedded live tiles                   |
| `data-grid` | Edit bounded typed rows                               | Data is local state until submitted                           |
| `media`     | Display HTTPS image/video/audio                       | Remote media is not fetched through a privileged server proxy |

These are optional building blocks, not fixed page templates. The agent can mix them with groups, tabs, state-bound controls, and ordinary display components to produce a task-specific interface.

## Learning assessments

`create_exam` creates a public question specification and a separate server-side encrypted answer key. It requires an answer-key entry for every question. Objective questions use correct option IDs; written questions use exact accepted answers, a rubric whose criterion points total the question value, or `manualReview: true` when a tutor/agent must assess the response. The answer key and grading rules are encrypted with AES-256-GCM and are never included in the public exam metadata or browser-synchronized tool input. The encryption key comes from `DIVEEOI_EXAM_ENCRYPTION_KEY` (32 bytes encoded as hex or base64) or a persistent `exam-answer-key.bin` file in DiveeOI's data directory, created with mode `0600`. Operators must preserve that key in protected backups; losing it makes existing answer keys undecryptable. Rotate it only with a deliberate key-migration procedure.

`grade_exam` verifies session ownership and attempt order, grades objective answers, applies configured partial credit and negative marking, matches accepted written answers, scores rubric criteria, and stores the answer and interactive settings for each attempt. Ambiguous written answers are flagged for tutor/agent review rather than assigned a fabricated automatic score. `review_exam` updates only written questions marked for review and recomputes the result. `attemptsAllowed` controls retries. Optional adaptive settings select a difficulty-matched subset and adjust the next attempt's difficulty based on the previous percentage. Question-order randomization happens once at creation; reloading an already-normalized spec does not shuffle it again. `export_exam` creates JSON or CSV with attempts, answers, grading feedback, simulation settings, and aggregate analytics; it excludes answer keys and requests the normal `export_exam` permission.

Interactive question state is kept separate from answers, saved with the exam attempt, and included in the grading submission. The app displays per-question results, partial credit, tutor-review status, attempt totals, and retry availability.

## Security and CSP

The renderer consumes structured data and uses statically bundled SolidJS components. It does not use `eval`, `Function`, script injection, arbitrary stylesheets, or model-provided source code. Interactive behavior is implemented in trusted renderer code and constrained by server-side parsing. The exam answer-key fields are separated from the public exam spec, encrypted at rest, and redacted from persisted tool-call/event data and plugin hooks. A component that needs a real external action must use an existing authorized tool or a separately implemented application capability rather than smuggling an endpoint or callback into a UI spec.

## Runtime clocks and locations

The server injects a fresh `<runtime_context>` block into each model step. It carries the UTC instant, the user's local date/time and timezone when provided by the browser, locale, coarse user location and source, plus a separate host date/time, OS timezone, and approximate public network-egress location. User-facing dates and schedules use the user's timezone; machine operations use the host timezone. Background runs must use their own fresh context rather than embedding old timestamps.

User location comes only from a trusted proxy's coarse geolocation headers or a clearly labeled timezone-derived country fallback. Host location comes from an operator override or a cached public-IP geolocation lookup. Both are approximate and can reflect network egress, VPNs, proxies, or carrier routing. Raw IP addresses, exact street addresses, and coordinates are never included in model context. Operators can set `DIVEEOI_HOST_LOCATION` and `DIVEEOI_HOST_TIMEZONE`, or disable host lookup with `DIVEEOI_DISABLE_HOST_GEOLOCATION=1`.

Targeted Learning allows `create_ui`, `create_exam`, `grade_exam`, `review_exam`, and `export_exam`. All subject-matter facts and UI sample data, labels, and calculated examples in that mode must come from passages read/retrieved during the current turn. Export still uses the ordinary permission flow.

## Remaining capability boundary

Direct per-component API/database bindings and a general credential-vault/connector binding are intentionally not exposed in Rich UI yet. Generated UI specs cannot supply arbitrary URLs, SQL, headers, credentials, or executable callbacks. Real external actions continue through the current agent's existing authorized tools, integrations, and MCP connections, preserving their existing permissions and approvals. Persistent Rich UI state is browser-profile scoped; it is not yet a server-side, cross-device state store. The map renderer is a coordinate preview rather than a live tile widget.
