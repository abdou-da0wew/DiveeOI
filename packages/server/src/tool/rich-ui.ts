import { randomUUID } from "node:crypto"
import { Effect, Schema } from "effect"
import type { ChatUISpec } from "@diveeoi/db/chat-ui"
import { parseChatUISpec } from "@diveeoi/db/chat-ui-parse"
import { richUIParameters } from "./rich-ui-schema"
import * as Tool from "./tool"

type RichUIMetadata = { error?: boolean; richUi?: ChatUISpec }

export const RichUITool = Tool.define(
  "create_ui",
  Effect.succeed({
    description: `Create a native interactive UI component inside the current chat response. Use this for a visual dashboard, chart, comparison table, metric cards, progress view, or a hands-on simulation. The renderer supports nested layout groups, shared-state tabs and conditionals, validated text/number/toggle/select fields, file attachments, editable data grids, maps, remote media, computed values, and buttons with safe state actions, plus headings, text, metrics, callouts, progress, charts, tables, simulations, workflow, desktop, database, API, scene, wizard, monitor, and circuit components. Design a fresh component tree for each request: select only the components that fit, nest related UI in groups/tabs, and declare state for every field, output, tab selector, grid, file upload, and button action. Fields support required, min/max, length, pattern, and help-text constraints. A file-upload component can attach up to five supported images, PDFs, text, Markdown, CSV, or JSON files to a submission (8 MB per file by default, configurable up to 12 MB, 20 MB total); selection alone does not upload anything. Maps provide validated coordinates and a coordinate preview with an OpenStreetMap link; they do not claim to embed live basemap tiles. Editable data grids save their rows into declared string state as JSON. Media uses HTTPS URLs only. Advanced components provide bounded built-in interactions: workflow node selection/execution, desktop app switching, sample database record inspection, simulated API requests, scene rotation, multi-step forms, monitor refresh/pause, and Ohm's-law circuit controls. A simulation has controls (slider, toggle, select) and outputs computed with a bounded expression tree; reference controls by their id using an input expression. API panels are local simulations and never issue network requests. Buttons may run local set/toggle/increment/filter/navigation actions; \`submit\` hands the current state and selected files to the active conversation, while \`refresh\` requests a fresh result from the agent. The application then uses the current agent's ordinary tools and permission flow. A UI submission does not authorize an external action by itself. Set \`persistState: true\` only when the user asks to retain non-sensitive form values across reloads; persistence is browser-profile and session scoped. Never collect credentials or secrets in persistent UI state. Never attempt to return HTML, CSS, JavaScript, or arbitrary code. Keep the UI focused and compact. The full spec belongs in the spec argument.`,
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
