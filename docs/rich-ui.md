# DiveeOI Rich UI protocol

DiveeOI rich interfaces are declarative, model-authored component trees rendered by a statically bundled SolidJS component registry. The model designs the experience; the renderer supplies responsive behavior, accessible controls, safe local interactions, and consistent visual hierarchy.

The protocol deliberately does **not** accept model-authored HTML, CSS, JavaScript, JSX, arbitrary callbacks, DOM selectors, dynamic imports, or network handlers. Visuals and interactions are built from validated component data and a bounded numeric expression language.

## 1. Layout modes

Every UI has a `layoutMode`. If omitted, it defaults to `auto`.

| Mode | Who designs the composition? | Who handles spacing and responsiveness? | Use it when |
| --- | --- | --- | --- |
| `auto` | The model supplies meaningful content and component order. | The renderer chooses responsive columns, spacing, and visual hierarchy. | Default. The model should not have to think about borders, gaps, or grid breakpoints. |
| `hybrid` | The model chooses groups, tabs, root layout hints, and meaningful separators. | The renderer handles responsive behavior and flattens nested visual surfaces. | The composition matters, but the model should not micromanage every style. |
| `manual` | The model explicitly defines the layout and surface hierarchy. | The renderer follows those declared choices while keeping controls accessible and bounded. | Precise layouts, dashboards, custom panels, and deliberate art direction. |

### Auto

Use:

```json
{
  "title": "Study overview",
  "layoutMode": "auto",
  "components": [
    { "type": "metric", "label": "Water coverage", "value": 70, "unit": "%" },
    { "type": "metric", "label": "Fresh water available", "value": 1, "unit": "%" },
    { "type": "chart", "title": "Water distribution", "kind": "bar", "points": [
      { "label": "Salt water", "value": 97 },
      { "label": "Frozen", "value": 2 },
      { "label": "Available fresh", "value": 1 }
    ]},
    { "type": "text", "content": "Most of Earth's water is not directly available for drinking." }
  ]
}
```

In auto mode, omit the root `layout` when the renderer should decide. The renderer uses responsive auto-fit columns for compact components and lets long text, headings, quizzes, diagrams, maps, tables, and other wide components occupy the full row. A supplied `layout: "stack"` is a single-column hint; `layout: "grid"` is a responsive grid hint.

Groups are unboxed by default. Do not use groups just to create cards. Use them to express a real relationship between components.

### Hybrid

Use when the model knows the semantic layout but wants the renderer to make it fit the viewport:

```json
{
  "title": "Experiment",
  "layoutMode": "hybrid",
  "layout": "grid",
  "components": [
    {
      "type": "group",
      "id": "inputs",
      "title": "Inputs",
      "layout": "grid",
      "gap": "normal",
      "surface": "subtle",
      "components": []
    }
  ]
}
```

Hybrid mode respects the root `layout` when provided. It respects the model's top-level group surface choices, but flattens surfaces on nested groups and nested tabs. This prevents a card from being placed inside another card while preserving the model's semantic composition.

### Manual

Manual mode is the full-composition escape hatch. It requires an explicit root `layout`:

```json
{
  "title": "Operations console",
  "layoutMode": "manual",
  "layout": "grid",
  "components": [
    {
      "type": "group",
      "id": "left-panel",
      "layout": "stack",
      "surface": "outlined",
      "gap": "relaxed",
      "separator": "none",
      "components": []
    },
    {
      "type": "group",
      "id": "right-panel",
      "layout": "stack",
      "surface": "subtle",
      "gap": "normal",
      "components": []
    }
  ]
}
```

Manual mode respects `stack`, `row`, and `grid` groups, `tight`, `normal`, and `relaxed` gaps, `none`, `subtle`, and `outlined` surfaces, and `none`, `top`, `bottom`, and `between` separators. Use explicit surfaces sparingly: even manual layouts look better with a clear hierarchy than with every group boxed.

## 2. Surface hierarchy and visual quality

The renderer provides **one outer UI shell** with a title and description. Components should not recreate that shell.

Follow these rules:

1. **Never create card-in-card layouts by default.** Do not wrap every metric, chart, table, simulation, quiz, map, or diagram in its own bordered rounded container. Those components already provide their own visual structure.
2. **Groups are structural, not decorative.** Use a group to express a coherent set of components or an intentional responsive row/grid. In auto mode, groups stay unboxed. In hybrid mode, only top-level group surfaces are honored. In manual mode, declared surfaces are respected.
3. **Prefer whitespace over borders.** Separate sections with spacing and typography. Use a divider only when there is a real conceptual boundary.
4. **Use backgrounds with purpose.** A subtle background can distinguish a code preview, diagram canvas, selected result, or interactive control. Avoid repeating the same background on every ancestor.
5. **Use hierarchy, not repetition.** One clear heading, short supporting text, a focused visual, then the relevant control is usually better than several nested panels with repeated titles.
6. **Keep controls next to their outputs.** A slider that changes a chart should be in the same group or adjacent to the chart. Avoid splitting cause and effect across unrelated tabs.
7. **Design mobile-first.** Use short labels, keep controls full-width where appropriate, use rows only for compact related content, and allow tables/diagrams to scroll horizontally rather than squeezing labels until they become decorative noise.
8. **Avoid empty UI.** Do not add decorative metrics, tabs, cards, or charts just to make the response look larger.

### Explicit separators

The `divider` component supports a solid or dashed line and an optional label:

```json
{ "type": "divider", "label": "Practice", "style": "solid" }
```

Groups may also declare a separator: `top`, `bottom`, or `between`. In auto mode, prefer letting the renderer decide; in hybrid/manual, use these only when the visual break communicates structure.

## 3. Root spec and state

A `ChatUISpec` contains:

- `id`: generated by the server.
- `version`: currently `1`.
- `title` and optional `description`.
- `layoutMode`: `auto`, `hybrid`, or `manual`; defaults to `auto`.
- Optional root `layout`: `stack` or `grid`.
- Optional `persistState: true`.
- Optional state declarations.
- Between 1 and 24 components.

The root state array contains unique primitive `{ key, value }` declarations. Values may be strings, finite numbers, or booleans. Fields, tab selectors, conditionals, button actions, computed expressions, file uploads, editable grids, and live charts must reference declared keys. The parser validates value types and references before the UI reaches the client.

State is local to the rendered UI instance by default. `persistState: true` restores declared, type-compatible primitive values from browser-profile storage scoped by session ID and UI ID. This is not a secret store or cross-device database. Never persist credentials, API keys, passwords, tokens, or other secrets.

## 4. Component catalogue

### Content and hierarchy

| Component | Purpose |
| --- | --- |
| `heading` | Section heading, level 2 or 3. |
| `text` | Markdown-formatted explanatory content. |
| `divider` | Optional labeled solid/dashed separator. |
| `callout` | Focused info, success, or warning note. |
| `metric` | One important value with an optional unit/tone. |
| `progress` | Bounded current/max progress display. |
| `table` | Static, readable comparison or reference table. |

### Composition and forms

| Component | Purpose | Interaction |
| --- | --- | --- |
| `group` | `stack`, `row`, or `grid` semantic layout. | Children share root state. Optional gap/surface/separator. |
| `tabs` | Switch between 2–8 labeled panels. | Optional declared string key synchronizes the selected tab. |
| `conditional` | Show children when a typed state value equals a declared value. | Reacts immediately to state. |
| `field` | Text, number, toggle, or select input. | Updates state; supports required, ranges, length, patterns, options, and help text. |
| `button` | Explicit action surface. | Bounded set/toggle/increment/filter/navigate/submit/refresh actions. |
| `file-upload` | Select supported files. | Attaches selected files only on submit/refresh. |
| `state-value` | Display one declared state value. | Updates reactively. |
| `computed` | Derive a numeric value. | Recalculates through the bounded numeric expression tree. |

### Interactive learning

#### Quiz

`quiz` creates an answerable exercise with progress, answer checking, correct/incorrect feedback, explanations, final score, and retry.

- 1–10 questions.
- 2–6 options per question.
- Each option and question has a unique ID.
- `selection: "single"` requires exactly one correct option.
- `selection: "multiple"` permits multiple correct options.
- Include concise explanations so feedback teaches, not merely grades.

Example:

```json
{
  "type": "quiz",
  "title": "Water cycle check",
  "questions": [{
    "id": "q1",
    "prompt": "Which process forms clouds?",
    "selection": "single",
    "options": [
      { "id": "evap", "label": "Evaporation" },
      { "id": "condense", "label": "Condensation" }
    ],
    "correctOptionIds": ["condense"],
    "explanation": "Water vapor cools and forms tiny liquid droplets."
  }]
}
```

#### Diagram

`diagram` renders a connected node graph with directional layout, edge labels, selectable nodes, and a detail panel.

- 2–12 nodes and 1–24 edges.
- Each node has an ID, label, optional detail, and kind (`start`, `process`, `decision`, `output`).
- Each edge references two declared node IDs.
- Choose `left-right` for short processes or `top-down` for vertical sequences.
- Keep labels short and details explanatory.

### Playable 2D platformer

Use `platformer` when the user explicitly asks for a playable game or when movement is the best way to demonstrate a concept. It renders a self-contained 2D SVG level with button controls and deterministic local physics.

A platformer contains:

- A bounded world (`width` 320–1400, `height` 240–900) and a starting player rectangle.
- 1–20 solid platforms, up to 12 hazards, up to 20 collectibles, up to 5 checkpoints, and one goal.
- A visual theme (`neon`, `sky`, or `forest`).
- Bounded physics: movement speed, gravity, jump velocity, lives, double-jump, and dash.

Example:

```json
{
  "type": "platformer",
  "title": "Neon Runner",
  "description": "Collect the crystals and reach the exit.",
  "theme": "neon",
  "width": 800,
  "height": 450,
  "player": { "x": 28, "y": 326, "width": 24, "height": 34 },
  "platforms": [
    { "id": "start", "x": 0, "y": 360, "width": 190, "height": 90 },
    { "id": "ledge", "x": 240, "y": 290, "width": 120, "height": 24 },
    { "id": "finish-ground", "x": 430, "y": 360, "width": 370, "height": 90 }
  ],
  "hazards": [{ "id": "spikes", "x": 490, "y": 330, "width": 48, "height": 30 }],
  "collectibles": [{ "id": "crystal-a", "x": 120, "y": 330 }],
  "checkpoints": [{ "id": "midpoint", "x": 440, "y": 360 }],
  "goal": { "x": 750, "y": 294, "width": 26, "height": 66 },
  "physics": {
    "moveSpeed": 5.2,
    "gravity": 0.82,
    "jumpVelocity": 14.5,
    "maxLives": 3,
    "doubleJump": true,
    "dash": true
  }
}
```

Controls include left/right movement, vertical and directional jumps, dash, wait, a frames-per-press slider, and restart. The physics engine handles landing, collectible pickup, hazard collisions, falling, checkpoint activation/respawn, lives, and victory. Button presses advance 2–12 deterministic simulation frames; this is a turn-driven chat game, not an autonomous 60 FPS background loop. Keep levels fair: the spawn must be safe, platforms must be reachable, hazards must be avoidable, and the goal must be attainable with the supplied movement physics.

The parser bounds all entity counts, IDs, dimensions, coordinates, and physics values. No game-authored code or arbitrary SVG is accepted; the renderer draws only its predefined safe primitives.

### Charts and live data

Charts support `bar` and `line`. Static points use `{ label, value }`. A live point uses `{ label, key }`, where `key` must reference a declared numeric state value:

```json
{
  "state": [{ "key": "temperature", "value": 22 }],
  "components": [
    { "type": "field", "id": "temperature-input", "key": "temperature", "label": "Temperature", "control": "number", "min": 0, "max": 50 },
    { "type": "chart", "title": "Temperature", "kind": "line", "points": [
      { "label": "Current", "key": "temperature" },
      { "label": "Reference", "value": 20 }
    ]}
  ]
}
```

Changing the field updates the chart immediately. A key binding must point to numeric state; strings and booleans are rejected. Do not call a static chart "live".

### Simulations

A `simulation` contains 1–8 controls (slider, toggle, select) and 1–8 outputs. Each output uses a validated expression tree and can reference control IDs through `{ op: "input", name: "controlId" }`. Supported operators are literal, input, negation, absolute value, square root, add, subtract, multiply, divide, power, min, and max. The tree is depth-bounded; arbitrary source code is never evaluated.

Keep the number of controls small. Show only outputs that help explain the relationship. Keep formulas, units, and labels consistent.

### Advanced built-ins

| Component | Behavior and limits |
| --- | --- |
| `platformer` | Play a bounded 2D level with platforms, hazards, collectibles, checkpoints, lives, double-jump, and dash. |
| `workflow` | Select nodes, add bounded process nodes, execute the local workflow simulation. |
| `desktop` | Switch between sample desktop apps/windows. |
| `database` | Inspect sample rows and selected record details. |
| `api` | Simulated local API requests; never performs a real network request. |
| `scene` | Rotate/select built-in 3D-style primitive scenes. |
| `wizard` | Multi-step guided form. |
| `monitor` | Refresh/pause built-in monitor metrics. |
| `circuit` | Interactive Ohm's-law controls and computed output. |
| `map` | Validated latitude/longitude coordinate preview and OpenStreetMap link; not an embedded live basemap. |
| `data-grid` | Typed text/number columns, bounded row count, optional editing. |
| `media` | HTTPS image, video, or audio from public hostnames. |

## 5. Safe actions and submissions

Button local actions are limited to:

- `set`: replace a declared value without changing its type.
- `toggle`: invert a boolean.
- `increment`: add a bounded numeric delta.
- `filter`: set a same-typed primitive value.
- `navigate`: select a declared tab.
- `submit`: hand current state and selected files to the active conversation.
- `refresh`: hand current state to the agent and request a fresh result.

There are no arbitrary event handlers, code strings, direct network callbacks, DOM selectors, or dynamic imports. Submit and refresh are conversation handoffs, not privileged HTTP or database callbacks. The application uses the current agent's ordinary tools and permission flow for any subsequent action. A UI submission does not itself authorize external side effects.

File uploads accept PNG/JPEG/WebP/GIF images, PDF, plain text, Markdown, CSV, and JSON. A UI can select up to five files, each no larger than the configured size (8 MB by default, maximum 12 MB), with a 20 MB total submission limit. File bytes are ephemeral and are not restored by persistence.

Editable data-grid rows are serialized as JSON in their declared string state (up to 48 KB, with 100-character text cells) and included in a form submission. They are data, never executable source.

Media requires HTTPS URLs on public hostnames. Credentials, IP-literal hosts, localhost, and common local-network hostnames are rejected.

## 6. Design recipes

### Explanation with a visual

Use a short heading and short prose, then a diagram that shows the causal sequence, followed by one small quiz. Keep the quiz to one or two questions if the user asked for a simple explanation.

### Hands-on science lesson

Use a small set of controls, a live chart bound to the same declared numeric state, and one computed output. Add an explanation of what changes and why.

### Comparison dashboard

Use 2–4 metrics, one chart or table, and a concise callout. In auto mode, omit the layout and let the renderer position compact elements. Do not put every metric inside a group with an outlined surface.

### Process or system explanation

Use a diagram with 3–8 nodes, concise edge labels, and meaningful node details. Choose the direction that matches the natural reading order.

### Multi-part reference

Use tabs only when content genuinely represents alternate views. If the user needs to see the whole sequence at once, use a stack or diagram instead.

## 7. Validation contract

- Components are statically rendered from a bounded schema.
- Nested component arrays are bounded to four levels and 64 total components; each list has its own item cap.
- IDs are unique and validated.
- State bindings and action types are type-checked.
- Numeric expressions are bounded and safe.
- Quiz answers and diagram edges must reference declared options/nodes.
- Live chart bindings must reference declared numeric state.
- Unsafe media URLs and unsupported upload types are rejected.
- No model-supplied markup, scripts, stylesheets, or arbitrary code are evaluated.
