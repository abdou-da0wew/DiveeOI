import { randomUUID } from "node:crypto"
import { Effect, Schema } from "effect"
import type { ChatUISpec } from "@diveeoi/db/chat-ui"
import { parseChatUISpec } from "@diveeoi/db/chat-ui-parse"
import { richUIParameters } from "./rich-ui-schema"
import * as Tool from "./tool"

type RichUIMetadata = { error?: boolean; richUi?: ChatUISpec }

const description = [
  "Create a native, interactive UI inside the current chat response. Build a task-specific experience, not a generic dashboard. The renderer provides declarative text, headings, metrics, callouts, progress, dividers, tables, static or state-bound live charts, formula simulations, interactive quizzes, clickable diagrams, responsive groups, tabs, conditionals, form fields, buttons, file uploads, editable data grids, maps, media, workflows, desktop previews, sample databases, API simulations, scenes, wizards, monitors, and circuit simulators.",
  "",
  "LAYOUT MODE IS IMPORTANT. Pick one mode on every substantial UI:",
  "- layoutMode='auto' (default): use when the user did not ask to control layout. Prefer omitting the root layout and group surface/separator settings. The renderer chooses responsive columns, spacing, and the visual hierarchy. Give it a clean semantic component sequence and let it compose it.",
  "- layoutMode='hybrid': use when you want to design the composition but want the renderer to handle responsive behavior and avoid nested surfaces. Define meaningful groups, tabs, root layout hints, and optional separators. Group surfaces are honored only at the outer composition level; nested groups are flattened to prevent card-in-card UI.",
  "- layoutMode='manual': use only when exact placement and visual grouping matter. It requires an explicit root layout ('stack' or 'grid'). Specify every group layout ('stack', 'row', or 'grid'), gap ('tight', 'normal', 'relaxed'), surface ('none', 'subtle', 'outlined'), separator ('none', 'top', 'bottom', 'between'), and explicit divider that you need. Manual is the escape hatch; do not use it by default.",
  "In auto mode, a root layout hint of 'stack' keeps one column; 'grid' enables responsive auto-fit columns. If no layout is supplied, the renderer chooses. In hybrid mode a supplied root layout is respected; if omitted, responsive auto-fit is used. In manual mode the root layout and explicit group choices are respected.",
  "",
  "SURFACE HIERARCHY: the renderer supplies one outer UI shell. Do not recreate that shell inside the UI. Never wrap every component in a group, card, bordered panel, or rounded background. A group is for semantic structure, not decoration. Keep groups unboxed ('surface':'none') unless a distinct work area genuinely needs separation. Avoid borders on groups inside other groups. Prefer spacing, typography, one subtle background surface, and a divider between sections. Use a divider component for a real section break. Metrics, charts, tables, forms, simulations, diagrams, and quizzes are already self-contained and normally should not be wrapped in more cards.",
  "RESPONSIVE DESIGN: build mobile-first. Keep labels short, avoid tiny side-by-side columns, put long text, tables, diagrams, maps, quizzes, and media on their own row in auto layouts, and use grid/row groups only for content that benefits from comparison. Keep related controls near the output they change. Do not create huge empty dashboard tiles.",
  "",
  "INTERACTION DESIGN: every control must have a meaningful visible effect. Use declared root state for fields, tabs, conditional visibility, button actions, editable grids, and live charts. A live chart point can be {label, key} where key names a declared numeric state value; static points use {label, value}. A slider/field/button can update that same key and the chart redraws immediately. Use simulations for formula-driven controls and outputs; formulas are bounded expression trees, not code. Use quiz for answer selection, checking, explanations, progress, and a final score. Use diagram for connected labeled nodes; selecting a node reveals its detail. Use platformer when the user asks for a playable 2D game or a movement-based demonstration: provide a bounded world, platforms, hazards, collectibles, checkpoints, a goal, and reasonable physics. Use tabs for alternate views, conditional for state-dependent views, and data-grid only when rows need inspection or editing.",
  "QUIZ QUALITY: keep each question focused, use 2-5 concise options, set exactly one correct option for single-choice questions, and include a short explanation that teaches why. Use multiple-choice only when more than one answer is genuinely correct. Avoid trick questions unless requested. Self-grading quiz answer IDs are for general learning UIs only; graded exams use the secure exam question/answerKey flow instead.",
  "PLATFORMER QUALITY: treat the platformer as a small deterministic local game. Use a sensible world size (often 800x450), a player who starts on a real platform, platforms large enough to land on, hazards that are avoidable, collectibles placed along the route, checkpoints before difficult sections, and a reachable goal. Avoid impossible geometry and overlapping hazards at the spawn. Use 3 lives, moderate gravity, and optional double-jump/dash unless the user asks for different difficulty. Button presses advance a bounded number of physics frames; do not describe it as an autonomous real-time game loop.",
  "DIAGRAM QUALITY: choose a clear direction, 3-8 nodes when possible, concise labels, useful edge labels, and meaningful node details. Connect only real relationships. Do not use a diagram as decoration when a simple list is clearer.",
  "CHART QUALITY: choose a chart type that fits the data, use readable labels, and do not fabricate precision. Use live state bindings only when the user can change the underlying values. Keep chart values and visible units consistent.",
  "TEACHING UI: for explanations, combine short prose with one useful visual (diagram, process flow, comparison, or simulation) and one small interaction (quiz, slider, toggle, or selectable node) when it materially improves understanding. Do not turn every answer into a quiz. Provide the explanation in the requested language; keep labels concise and explanations useful.",
  "",
  "STATE AND ACTIONS: declare a unique {key, value} for every state-backed field, tab selector, conditional, data grid, file upload, button action, computed value, and live chart binding. Values are primitives only. Components reference keys; they do not create implicit state. Button actions are limited to set, toggle, increment, filter, navigate, submit, and refresh. Submit/refresh hand state and selected files back to the current conversation as untrusted user input. They are not privileged network calls or external side effects.",
  "FILE UPLOADS: up to five supported PNG/JPEG/WebP/GIF images, PDFs, text, Markdown, CSV, or JSON files; 8 MB per file by default, configurable up to 12 MB, 20 MB total. Selecting a file does not upload it; submit/refresh attaches it.",
  "MAPS AND MEDIA: maps validate coordinates and show a coordinate preview with an OpenStreetMap link; they do not claim to embed live basemap tiles. Media URLs must be HTTPS and on public hostnames. Never imply that an API panel performs a real network request; it is a local simulation.",
  "PERSISTENCE: set persistState=true only when the user asks to retain non-sensitive form values across reloads. Persistence is browser-profile and session scoped. Never collect credentials or secrets in persistent state.",
  "SAFETY AND VALIDATION: never return HTML, CSS, JavaScript, JSX, arbitrary expressions, DOM selectors, or event-handler source. Use only the supported component schema and bounded numeric expressions. IDs must be unique and valid. If validation fails, correct the spec and call create_ui again.",
  "Create only the UI that helps the current task. Use the full spec in the spec argument."
].join("\n")

export const RichUITool = Tool.define(
  "create_ui",
  Effect.succeed({
    description,
    parameters: Schema.Struct({ spec: Schema.Unknown }),
    jsonSchema: richUIParameters,
    execute: (
      args: { spec: unknown },
      ctx: Tool.Context,
    ): Effect.Effect<{ title: string; output: string; metadata: RichUIMetadata }> =>
      Effect.gen(function* () {
        const parsed = parseChatUISpec(args.spec, randomUUID())
        if (!parsed.ok) {
          return {
            title: "Unable to create UI",
            output: `The UI specification is invalid: ${parsed.error}. Correct the spec and call create_ui again.`,
            metadata: { error: true },
          }
        }
        const spec = parsed.value
        yield* ctx.metadata({ title: spec.title, metadata: { richUi: spec } })
        return {
          title: spec.title,
          output: `Created an interactive UI named "${spec.title}" with ${spec.components.length} components. The UI is rendered above this tool result.`,
          metadata: { richUi: spec },
        }
      }),
  }),
)
