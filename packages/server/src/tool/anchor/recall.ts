import { Effect, Schema } from "effect"
import { SessionV1 } from "@diveeoi/db/v1/session"
import { Anchor } from "../../anchor/anchor"
import * as Tool from "../tool"
import DESCRIPTION from "./recall.txt"

export const Parameters = Schema.Struct({
  refs: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Reference ids from the anchor tree. Every entry must be a ref you were shown; do not invent them.",
  }),
})

type Metadata = {
  refs: string[]
}

export const RecallContextTool = Tool.define<typeof Parameters, Metadata, Anchor.Service>(
  "recall_context",
  Effect.gen(function* () {
    const anchor = yield* Anchor.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          // Reads only, but it can pull a lot of content into the transcript, so it is an
          // explicit action the user can see and deny - same as reading a file.
          yield* ctx.ask({
            permission: "recall_context",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const refs = params.refs.map((ref) => ref.trim()).filter((ref) => ref.length > 0)
          if (refs.length === 0) {
            return {
              title: "no refs given",
              output:
                "No refs to look up. Pass the ref ids shown in the anchor - use search_memory to find them by content.",
              metadata: { refs: params.refs },
            }
          }

          const parts = yield* anchor.resolveRefs(refs, ctx.sessionID)
          const found = new Set<string>(parts.map((part) => String(part.id)))
          const missing = refs.filter((ref) => !found.has(ref))

          if (parts.length === 0) {
            return {
              title: `no content for ${params.refs.length} ref(s)`,
              output:
                `None of these refs resolve to content in this session: ${refs.join(", ")}.\n` +
                `They may come from a different session, or from context that was never indexed. ` +
                `Use search_memory to find refs by content instead.`,
              metadata: { refs: params.refs },
            }
          }

          // Originals are returned verbatim and in the order asked for, not grouped by message,
          // so the model reads them the way it asked for them.
          const byRef = new Map<string, SessionV1.Part>(parts.map((part) => [String(part.id), part]))
          const body = refs
            .filter((ref) => byRef.has(ref))
            .map((ref) => {
              const part = byRef.get(ref)!
              // `output` only exists on the completed variant of the tool-state union; every
              // other part type carries its text directly.
              let text: string | undefined
              if (part.type === "tool") {
                const state = part.state
                text = state && state.status === "completed" ? state.output : undefined
              } else if (part.type === "text" || part.type === "reasoning") {
                text = part.text
              }
              return `── ref ${ref} ──\n${text ?? "(no text)"}`
            })
            .join("\n\n")

          const footer = missing.length > 0 ? `\n\n(unresolved refs: ${missing.join(", ")})` : ""

          yield* ctx.metadata({ title: `recalled ${parts.length} ref(s)`, metadata: { refs } })

          return {
            title: `recalled ${parts.length} ref(s)`,
            output: `${body}${footer}`,
            metadata: { refs },
          }
        }),
    }
  }),
)
