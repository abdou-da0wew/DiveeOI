import { Effect, Schema } from "effect"
import { Anchor } from "../../anchor/anchor"
import * as Tool from "../tool"
import DESCRIPTION from "./edit.txt"

const Entry = Schema.Struct({
  ref: Schema.String.annotate({ description: "A ref you were shown in the current anchor." }),
  label: Schema.String.annotate({ description: "One short line. Read by a human, so make it stand alone." }),
})

const Section = Schema.Struct({
  ref: Schema.String.annotate({ description: "A ref you were shown in the current anchor." }),
  label: Schema.optional(Schema.String),
})

/**
 * The whole tree, not a patch.
 *
 * Accepting a partial update would mean merging semantics - which sections replace, which merge -
 * that the model would then have to reason about and get wrong. Sending the complete tree makes
 * every call idempotent and trivially predictable: what you send is what the anchor becomes.
 */
export const Parameters = Schema.Struct({
  objective: Section.annotate({ description: "What this session is for, in one line." }),
  decisions: Schema.mutable(Schema.Array(Entry)).annotate({
    description: "Decisions made and still in force. Cut anything reversed or superseded.",
  }),
  files: Schema.mutable(Schema.Array(Entry)).annotate({
    description: "Files that matter to this task, with why each one matters.",
  }),
  open_questions: Schema.mutable(Schema.Array(Entry)).annotate({
    description: "Questions genuinely still open. Remove any that have been answered.",
  }),
  status: Section.annotate({ description: "Where things stand right now, in one line." }),
  open_todos: Schema.optional(
    Schema.mutable(Schema.Array(Schema.Struct({ content: Schema.String }))).annotate({
      description: "What is still to do, in the order it should happen.",
    }),
  ),
})

type Metadata = {
  anchorID: string
  epoch: number
}

export const AnchorEditTool = Tool.define<typeof Parameters, Metadata, Anchor.Service>(
  "anchor_edit",
  Effect.gen(function* () {
    const anchor = yield* Anchor.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "anchor_edit",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const previous = yield* anchor.getLatest(ctx.sessionID)
          if (!previous) {
            return {
              title: "no anchor yet",
              output:
                "This session has no anchor yet - one is generated at the first compaction. Nothing to edit until then.",
              metadata: { anchorID: "", epoch: 0 },
            }
          }

          const tree: Anchor.AnchorTree = {
            objective: params.objective,
            decisions: params.decisions,
            files: params.files,
            open_questions: params.open_questions,
            status: params.status,
            ...(params.open_todos ? { open_todos: params.open_todos } : {}),
          }

          // Refs are validated against what this session has actually seen. Rejecting here is
          // much better than storing an anchor whose entries silently resolve to nothing.
          const available = yield* anchor.resolveRefs(
            [
              tree.objective.ref,
              tree.status.ref,
              ...tree.decisions.map((x) => x.ref),
              ...tree.files.map((x) => x.ref),
              ...tree.open_questions.map((x) => x.ref),
            ],
            ctx.sessionID,
          )
          const known = new Set<string>(available.map((part) => String(part.id)))
          const unknown = [
            tree.objective.ref,
            tree.status.ref,
            ...tree.decisions.map((x) => x.ref),
            ...tree.files.map((x) => x.ref),
            ...tree.open_questions.map((x) => x.ref),
          ].filter((ref) => ref !== Anchor.NO_REF && !known.has(ref))

          if (unknown.length > 0) {
            return {
              title: `${unknown.length} unknown ref(s)`,
              output: [
                `These refs do not belong to this session: ${unknown.join(", ")}.`,
                ``,
                `Refs come from the anchor you were shown - copy them exactly. Use NO_REF for the objective`,
                `when there is no message that states it.`,
              ].join("\n"),
              metadata: { anchorID: previous.id, epoch: previous.epoch },
            }
          }

          // History is immutable: the edit lands as a new row at the same epoch, so the anchor
          // in effect before the edit is still recoverable.
          const created = yield* anchor.create({
            sessionID: ctx.sessionID,
            epoch: previous.epoch,
            rootRef: tree.objective.ref,
            tree,
          })

          const counts = [
            `${tree.decisions.length} decision(s)`,
            `${tree.files.length} file(s)`,
            `${tree.open_questions.length} open question(s)`,
          ].join(", ")

          yield* ctx.metadata({ title: "anchor updated", metadata: { anchorID: created.id, epoch: created.epoch } })

          return {
            title: "anchor updated",
            output: `Anchor updated: ${counts}.`,
            metadata: { anchorID: created.id, epoch: created.epoch },
          }
        }),
    }
  }),
)
