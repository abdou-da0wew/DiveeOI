import { Effect, Schema } from "effect"
import { SessionID, MessageID, PartID } from "./schema"

export interface AnchorTree {
  objective: { ref: string }
  decisions: Array<{ ref: string; label: string }>
  files: Array<{ ref: string; label: string }>
  open_questions: Array<{ ref: string; label: string }>
  status: { ref: string; label: string }
  open_todos?: Array<{ content: string }>
}

const RefSchema = Schema.String

export const AnchorTreeSchema = Schema.Struct({
  objective: Schema.Struct({ ref: RefSchema }),
  decisions: Schema.Array(Schema.Struct({ ref: RefSchema, label: Schema.String })),
  files: Schema.Array(Schema.Struct({ ref: RefSchema, label: Schema.String })),
  open_questions: Schema.Array(Schema.Struct({ ref: RefSchema, label: Schema.String })),
  status: Schema.Struct({ ref: RefSchema, label: Schema.String }),
  open_todos: Schema.optional(Schema.Array(Schema.Struct({ content: Schema.String }))),
})

export const decodeAnchor = Schema.decodeUnknown(AnchorTreeSchema)

export interface ValidateResult {
  tree: AnchorTree
  missingRefs: string[]
  valid: boolean
}

export const validateAnchorRefs = (
  tree: AnchorTree,
  availableRefs: Set<string>,
): ValidateResult => {
  const missingRefs: string[] = []
  const checkRef = (ref: string) => {
    if (!availableRefs.has(ref)) missingRefs.push(ref)
  }
  checkRef(tree.objective.ref)
  for (const d of tree.decisions) checkRef(d.ref)
  for (const f of tree.files) checkRef(f.ref)
  for (const q of tree.open_questions) checkRef(q.ref)
  checkRef(tree.status.ref)
  return { tree, missingRefs, valid: missingRefs.length === 0 }
}

export const buildRepairPrompt = (
  validationErrors: string[],
  availableRefs: string[],
): string => {
  return `Your previous anchor output had validation errors. Fix them.

ERRORS:
${validationErrors.map((e) => `- ${e}`).join("\n")}

AVAILABLE REFS (use ONLY these):
${availableRefs.join(", ")}

RULES:
- Every ref MUST be from the available list above
- Output ONLY valid JSON matching the schema
- The "objective" ref is mandatory
- If uncertain about a section, leave it empty (empty array) — do not guess
- Do not add fields not in the schema`
}

export const repairAnchor = Effect.fn("Anchor.repair")(function* (
  rawOutput: string,
  availableRefs: Set<string>,
): Effect.Effect<AnchorTree, Error> {
  const parsed = yield* Schema.decodeUnknown(Schema.parseJson(AnchorTreeSchema))(rawOutput)
  const { tree, missingRefs, valid } = validateAnchorRefs(parsed, availableRefs)
  if (valid) return tree

  const errors = missingRefs.map((r) => `Unknown ref: ${r}`)
  throw new AnchorValidationError({ errors, availableRefs: [...availableRefs] })
})

export class AnchorValidationError extends Schema.TaggedError<AnchorValidationError>()(
  "AnchorValidationError",
  {
    errors: Schema.Array(Schema.String),
    availableRefs: Schema.Array(Schema.String),
  },
) {}

export const extractAvailableRefs = (messages: Array<{ id: string; parts: Array<{ id: string }> }>): Set<string> => {
  const refs = new Set<string>()
  for (const msg of messages) {
    refs.add(`msg_${msg.id}`)
    for (const part of msg.parts) {
      refs.add(`part_${part.id}`)
      refs.add(`tool_${part.id}`)
    }
  }
  return refs
}

export * as Anchor from "./anchor"