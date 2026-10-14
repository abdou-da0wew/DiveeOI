// packages/server/src/anchor/anchor.ts
// Anchor service: write/read/query linktree anchors, resolve refs back to original parts.
//
// Draft-10 P1 — "lossless context": instead of replacing history with a lossy summary,
// an anchor is a STRUCTURED INDEX of refs into the original messages/parts. The original
// messages are never deleted; `resolveRefs` walks an anchor back to the exact parts it
// points at, so a compacted context can always be re-expanded.
//
// Ref grammar (a ref is a plain string, always resolvable without extra state):
//   - `msg:<messageID>`                  -> the message
//   - `part:<messageID>:<partID>`        -> a specific part of a message
//   - `tool:<messageID>:<partID>`        -> a tool part (semantically distinct, same lookup)
//   - `msg:__NONE__`                     -> the degraded "no objective found" sentinel

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Database } from "@diveeoi/db/database/database"
import { SessionV1 } from "@diveeoi/db/v1/session"
import { EventV2 } from "@diveeoi/db/event"
import { Context, Effect, Layer, Schema } from "effect"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import { sql } from "drizzle-orm"
import { LLMEvent } from "@diveeoi/llm"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as Token from "@/util/token"
import { AnchorContentIndex } from "./content-index"

import PROMPT_ANCHOR from "./prompt/anchor.txt"

export const Event = {
  Anchored: EventV2.define({
    type: "anchor.created",
    schema: {
      sessionID: SessionID,
      anchorID: Schema.String,
      epoch: Schema.Number,
      degraded: Schema.Boolean,
    },
  }),
}

/** Sentinel ref used when the model cannot find a real objective message. */
export const NO_REF = "msg:__NONE__"

/**
 * Render an anchor tree as the block the model sees in place of compacted history.
 *
 * Kept prefix-stable (objective first, same headings every time) so a model that has seen the
 * anchor once knows where to look in it after every compaction.
 */
export function render(tree: AnchorTree): string {
  const lines: string[] = ["# Working memory (anchor)"]
  lines.push("")
  lines.push(
    "This is an index of the conversation so far, not the conversation. The originals still exist:",
    "use search_memory to find refs by content, and recall_context to read one in full.",
  )
  lines.push("")
  lines.push(`## Objective${tree.objective.label ? `: ${tree.objective.label}` : ""}`)
  lines.push(`(ref ${tree.objective.ref})`)
  lines.push("")
  lines.push(`## Status${tree.status.label ? `: ${tree.status.label}` : ""}`)
  lines.push(`(ref ${tree.status.ref})`)

  if (tree.decisions.length > 0) {
    lines.push("")
    lines.push("## Decisions")
    for (const item of tree.decisions) lines.push(`- ${item.label} (ref ${item.ref})`)
  }
  if (tree.files.length > 0) {
    lines.push("")
    lines.push("## Files")
    for (const item of tree.files) lines.push(`- ${item.label} (ref ${item.ref})`)
  }
  if (tree.open_questions.length > 0) {
    lines.push("")
    lines.push("## Open questions")
    for (const item of tree.open_questions) lines.push(`- ${item.label} (ref ${item.ref})`)
  }
  if (tree.open_todos && tree.open_todos.length > 0) {
    lines.push("")
    lines.push("## Open todos")
    for (const item of tree.open_todos) lines.push(`- ${item.content}`)
  }
  return lines.join("\n")
}

export const Info = Schema.Struct({
  id: Schema.String,
  session_id: SessionID,
  epoch: Schema.Number,
  root_ref: Schema.String,
  tree_json: Schema.Unknown,
  token_estimate: Schema.optional(Schema.Number),
  degraded: Schema.Boolean,
  created_at: Schema.Number,
})
export type Info = typeof Info.Type

export type RefSection = "objective" | "decisions" | "files" | "open_questions" | "status" | "open_todos"

export const AnchorTreeSchema = Schema.Struct({
  objective: Schema.Struct({ ref: Schema.String, label: Schema.optional(Schema.String) }),
  decisions: Schema.Array(Schema.Struct({ ref: Schema.String, label: Schema.String })),
  files: Schema.Array(Schema.Struct({ ref: Schema.String, label: Schema.String })),
  open_questions: Schema.Array(Schema.Struct({ ref: Schema.String, label: Schema.String })),
  status: Schema.Struct({ ref: Schema.String, label: Schema.optional(Schema.String) }),
  open_todos: Schema.optional(Schema.Array(Schema.Struct({ content: Schema.String }))),
})

export type AnchorTree = typeof AnchorTreeSchema.Type

export class AnchorValidationError extends Schema.TaggedErrorClass<AnchorValidationError>()("AnchorValidationError", {
  errors: Schema.Array(Schema.String),
  availableRefs: Schema.Array(Schema.String),
}) {
  override get message() {
    return "Anchor tree failed validation"
  }
}

export class AnchorDecodeError extends Schema.TaggedErrorClass<AnchorDecodeError>()("AnchorDecodeError", {
  output: Schema.String,
}) {
  override get message() {
    return "Anchor model output is not valid JSON matching the anchor schema"
  }
}

// ─────────────────────────────────────────────────────────────
//  Refs
// ─────────────────────────────────────────────────────────────

export type ParsedRef =
  | { readonly kind: "none" }
  | { readonly kind: "message"; readonly messageID: MessageID }
  | { readonly kind: "part"; readonly messageID: MessageID; readonly partID: string }

/** Parse a ref string. Returns `undefined` when the ref is not well-formed. */
export function parseRef(ref: string): ParsedRef | undefined {
  if (ref === NO_REF) return { kind: "none" }
  const separator = ref.indexOf(":")
  if (separator === -1) return undefined
  const prefix = ref.slice(0, separator)
  const rest = ref.slice(separator + 1)
  if (prefix === "msg") {
    if (!rest) return undefined
    return { kind: "message", messageID: MessageID.make(rest) }
  }
  if (prefix === "part" || prefix === "tool") {
    const split = rest.indexOf(":")
    if (split === -1) return undefined
    const messageID = rest.slice(0, split)
    const partID = rest.slice(split + 1)
    if (!messageID || !partID) return undefined
    return { kind: "part", messageID: MessageID.make(messageID), partID }
  }
  return undefined
}

/** Every ref the model is allowed to use, derived from the messages handed to it. */
export function collectRefs(messages: ReadonlyArray<SessionV1.WithParts>): Set<string> {
  const refs = new Set<string>([NO_REF])
  for (const message of messages) {
    refs.add(`msg:${message.info.id}`)
    for (const part of message.parts) {
      const prefix = part.type === "tool" ? "tool" : "part"
      refs.add(`${prefix}:${message.info.id}:${part.id}`)
    }
  }
  return refs
}

/**
 * Canonicalize a ref the model produced, tolerating the shapes it realistically emits.
 *
 * Existence stays strictly enforced - a ref to something not in the conversation is a hallucination
 * and must be rejected. Only the *spelling* is flexible: part ids are globally unique, so a bare
 * `part:<id>` is unambiguous and gets expanded to the canonical `part:<messageID>:<partID>`. Models
 * routinely drop the message-id segment, and rejecting an otherwise-correct anchor over that is a
 * bad trade.
 */
export function normalizeRef(ref: string, availableRefs: ReadonlySet<string>): string {
  if (availableRefs.has(ref)) return ref
  const separator = ref.indexOf(":")
  if (separator === -1) return ref
  const prefix = ref.slice(0, separator)
  const rest = ref.slice(separator + 1)
  if (prefix === "part" || prefix === "tool") {
    // Already canonical, just not a ref we have.
    if (rest.includes(":")) return ref
    for (const candidate of availableRefs) {
      const candidateSeparator = candidate.indexOf(":")
      if (candidateSeparator === -1) continue
      if (candidate.slice(0, candidateSeparator) !== prefix) continue
      if (candidate.slice(candidateSeparator + 1).endsWith(`:${rest}`)) return candidate
    }
  }
  return ref
}

export function treeRefs(tree: AnchorTree): string[] {
  return [
    tree.objective.ref,
    ...tree.decisions.map((entry) => entry.ref),
    ...tree.files.map((entry) => entry.ref),
    ...tree.open_questions.map((entry) => entry.ref),
    tree.status.ref,
  ]
}

export interface ValidateResult {
  readonly tree: AnchorTree
  readonly missingRefs: string[]
  readonly valid: boolean
}

/** Structural + referential validation of a decoded anchor tree. */
export function validateTree(value: unknown, availableRefs: ReadonlySet<string>): ValidateResult {
  const decoded = Schema.decodeUnknownResult(AnchorTreeSchema)(value)
  if (!Result.isSuccess(decoded)) return { tree: undefined as never, missingRefs: [], valid: false }
  // Refs are canonicalized on the way in, so a correct anchor is not lost over spelling.
  const tree = normalizeTreeRefs(decoded.success, availableRefs)
  const missingRefs = treeRefs(tree).filter((ref) => ref !== NO_REF && !availableRefs.has(ref))
  return { tree, missingRefs, valid: missingRefs.length === 0 }
}

function normalizeTreeRefs(tree: AnchorTree, availableRefs: ReadonlySet<string>): AnchorTree {
  const entry = <T extends { ref: string }>(item: T): T => ({ ...item, ref: normalizeRef(item.ref, availableRefs) })
  const list = (items: ReadonlyArray<{ ref: string; label: string }>) => items.map(entry)
  return {
    objective: entry(tree.objective),
    decisions: list(tree.decisions),
    files: list(tree.files),
    open_questions: list(tree.open_questions),
    status: entry(tree.status),
    ...(tree.open_todos ? { open_todos: tree.open_todos } : {}),
  }
}

export function buildRepairPrompt(validationErrors: string[], availableRefs: ReadonlySet<string>) {
  return [
    "Your previous anchor output was rejected. Fix it and output the corrected JSON only.",
    "",
    "ERRORS:",
    ...validationErrors.map((error) => `- ${error}`),
    "",
    "ALLOWED REFS (use ONLY these):",
    ...[...availableRefs].map((ref) => `- ${ref}`),
    "",
    "Emit EXACTLY this shape and nothing else - same section names, no renames, no extras:",
    '{"objective":{"ref":"msg:<id>"},"decisions":[{"ref":"msg:<id>","label":"..."}],',
    '"files":[{"ref":"msg:<id>","label":"..."}],"open_questions":[{"ref":"msg:<id>","label":"..."}],',
    '"status":{"ref":"msg:<id>","label":"..."}}',
    "",
    "RULES:",
    "- Every ref MUST come from the allowed list above.",
    "- Keep every section. An empty section is [] - never omit it and never rename it.",
    `- Use "${NO_REF}" for objective.ref only when no objective message exists.`,
    "- Output JSON only. No prose, no markdown fences.",
    "- A message ref is \"msg:<message id>\"; a part ref is \"part:<message id>:<part id>\". Copy them whole.",
  ].join("\n")
}

/** Serialize the messages handed to the model, including the ids refs must point at. */
export function buildAnchorPrompt(messages: ReadonlyArray<SessionV1.WithParts>) {
  const turns = messages.map((message) => ({
    info: { id: message.info.id, role: message.info.role },
    parts: message.parts.map((part) =>
      part.type === "text"
        ? { id: part.id, type: part.type, text: part.text }
        : part.type === "tool"
          ? {
              id: part.id,
              type: part.type,
              tool: part.tool,
              status: part.state.status,
              input: part.state.status === "completed" ? part.state.input : undefined,
            }
          : { id: part.id, type: part.type },
    ),
  }))
  return `${PROMPT_ANCHOR}\n\nMESSAGES:\n${JSON.stringify(turns, null, 2)}`
}

// ─────────────────────────────────────────────────────────────
//  Service
// ─────────────────────────────────────────────────────────────

/**
 * Smallest anchor that is still true, built without asking a model.
 *
 * The objective is the first user message worth anything and the status is the last thing the
 * assistant actually said. Both are facts about the transcript rather than judgements about it,
 * so this cannot hallucinate. Used when generation fails: an anchor that merely orients the agent
 * beats no anchor, and the `degraded` flag tells the UI the rich sections are missing.
 */
export function mechanicalTree(messages: ReadonlyArray<SessionV1.WithParts>): AnchorTree | undefined {
  const substantive = (message: SessionV1.WithParts) =>
    message.parts.some((part) => part.type === "text" && part.text.trim().length > 0)
  const firstUser = messages.find((message) => message.info.role === "user" && substantive(message))
  const lastAssistant = messages.findLast((message) => message.info.role === "assistant" && substantive(message))
  if (!firstUser && !lastAssistant) return undefined
  // The status label is the assistant's own last words, clipped - it orients a reader without
  // pretending to be a summary of anything.
  const lastText = lastAssistant?.parts.find(
    (part): part is SessionV1.TextPart => part.type === "text" && part.text.trim().length > 0,
  )?.text
  return {
    objective: { ref: firstUser ? `msg:${firstUser.info.id}` : NO_REF },
    decisions: [],
    files: [],
    open_questions: [],
    status: {
      ref: lastAssistant ? `msg:${lastAssistant.info.id}` : NO_REF,
      label: lastText ? lastText.trim().slice(0, 120) : "no assistant response yet",
    },
  }
}

export interface GeneratedAnchor {
  readonly tree: AnchorTree
  readonly degraded: boolean
}

export interface GenerateInput {
  readonly sessionID: SessionID
  readonly messages: ReadonlyArray<SessionV1.WithParts>
  readonly model: { readonly providerID: string; readonly modelID: string }
}

export interface SearchHit {
  readonly ref: string
  readonly snippet: string
  readonly rank: number
}

export interface Interface {
  readonly create: (input: {
    sessionID: SessionID
    epoch: number
    rootRef: string
    tree: AnchorTree
    /**
     * Whether this anchor is a partial index. Explicit rather than inferred: a tree can carry a
     * real objective and still be missing every decision, and inferring degradation from a ref
     * would have hidden exactly the cases worth showing.
     */
    degraded?: boolean
  }) => Effect.Effect<Info>
  readonly get: (anchorID: string) => Effect.Effect<Info | undefined>
  readonly list: (sessionID: SessionID, limit?: number) => Effect.Effect<ReadonlyArray<Info>>
  readonly getLatest: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly resolveRefs: (refs: ReadonlyArray<string>, sessionID: SessionID) => Effect.Effect<ReadonlyArray<SessionV1.Part>>
  readonly searchFTS: (input: {
    sessionID: SessionID
    query: string
    limit?: number
  }) => Effect.Effect<ReadonlyArray<SearchHit>>
  /** Index message parts into the session FTS table so dropped context stays searchable. */
  readonly index: (input: {
    sessionID: SessionID
    messages: ReadonlyArray<SessionV1.WithParts>
  }) => Effect.Effect<number>
  /**
   * Build an anchor tree from messages.
   *
   * `degraded: true` means the model could not produce a valid tree and the result is the
   * mechanical fallback instead - still true and still useful, but missing the sections only a
   * model can summarise. `undefined` only when the messages contain nothing to anchor.
   */
  readonly generate: (input: GenerateInput) => Effect.Effect<GeneratedAnchor | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/Anchor") {}

export const use = (): Effect.Effect<Interface, never, Service> => Effect.service(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const session = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const agent = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const contentIndex = yield* AnchorContentIndex.Service
    const db = database.db

    type AnchorRow = {
      id: string
      session_id: SessionID
      epoch: number
      root_ref: string
      tree_json: string
      token_estimate: number | null
      degraded: number
      time_created: number
    }

    const rowToInfo = (row: AnchorRow): Info => ({
      id: row.id,
      session_id: row.session_id,
      epoch: row.epoch,
      root_ref: row.root_ref,
      tree_json: JSON.parse(row.tree_json) as unknown,
      token_estimate: row.token_estimate ?? undefined,
      degraded: row.degraded === 1,
      created_at: row.time_created,
    })

    const create: Interface["create"] = Effect.fn("Anchor.create")(function* (input) {
      const now = Date.now()
      const id = `anc_${now}_${Math.random().toString(36).slice(2, 8)}`
      const degraded = input.degraded ?? input.tree.objective.ref === NO_REF
      const tokenEstimate = Token.estimate(JSON.stringify(input.tree))
      yield* db
        .run(sql`
        INSERT INTO session_anchor (id, session_id, epoch, root_ref, tree_json, token_estimate, degraded, time_created)
        VALUES (${id}, ${input.sessionID}, ${input.epoch}, ${input.rootRef}, ${JSON.stringify(input.tree)}, ${tokenEstimate}, ${degraded ? 1 : 0}, ${now})
      `)
        .pipe(Effect.orDie)

      const refs: Array<{ ref: string; section: RefSection; label: string }> = []
      let ordinal = 0
      const push = (section: RefSection, entries: ReadonlyArray<{ ref: string; label: string }>) => {
        for (const entry of entries) refs.push({ ref: entry.ref, section, label: entry.label })
      }
      push("decisions", input.tree.decisions)
      push("files", input.tree.files)
      push("open_questions", input.tree.open_questions)
      if (input.tree.objective.ref !== NO_REF) {
        refs.push({ ref: input.tree.objective.ref, section: "objective", label: "objective" })
      }
      if (input.tree.status.ref !== NO_REF) {
        refs.push({ ref: input.tree.status.ref, section: "status", label: input.tree.status.label ?? "status" })
      }

      for (const [index, entry] of refs.entries()) {
        yield* db
          .run(sql`
          INSERT INTO session_anchor_ref (anchor_id, ref, section, label, ordinal)
          VALUES (${id}, ${entry.ref}, ${entry.section}, ${entry.label}, ${ordinal + index})
        `)
          .pipe(Effect.orDie)
      }

      yield* events.publish(Event.Anchored, {
        sessionID: input.sessionID,
        anchorID: id,
        epoch: input.epoch,
        degraded,
      })

      return {
        id,
        session_id: input.sessionID,
        epoch: input.epoch,
        root_ref: input.rootRef,
        tree_json: input.tree as unknown,
        token_estimate: tokenEstimate,
        degraded,
        created_at: now,
      } satisfies Info
    })

    const get: Interface["get"] = Effect.fn("Anchor.get")(function* (anchorID) {
      const row = yield* db
        .get<AnchorRow>(sql`SELECT * FROM session_anchor WHERE id = ${anchorID}`)
        .pipe(Effect.orDie)
      if (!row) return undefined
      return rowToInfo(row)
    })

    const list: Interface["list"] = Effect.fn("Anchor.list")(function* (sessionID, limit = 50) {
      const rows = yield* db
        .all<AnchorRow>(
          sql`SELECT * FROM session_anchor WHERE session_id = ${sessionID} ORDER BY epoch DESC LIMIT ${limit}`,
        )
        .pipe(Effect.orDie)
      return rows.map(rowToInfo)
    })

    const getLatest: Interface["getLatest"] = Effect.fn("Anchor.getLatest")(function* (sessionID) {
      const row = yield* db
        .get<AnchorRow>(sql`SELECT * FROM session_anchor WHERE session_id = ${sessionID} ORDER BY epoch DESC LIMIT 1`)
        .pipe(Effect.orDie)
      if (!row) return undefined
      return rowToInfo(row)
    })

    const resolveRefs: Interface["resolveRefs"] = Effect.fn("Anchor.resolveRefs")(function* (refs, sessionID) {
      const messageIDs = new Set<MessageID>()
      const partIDs: Array<{ messageID: MessageID; partID: string }> = []
      for (const ref of refs) {
        const parsed = parseRef(ref)
        if (!parsed || parsed.kind === "none") continue
        if (parsed.kind === "message") messageIDs.add(parsed.messageID)
        else partIDs.push({ messageID: parsed.messageID, partID: parsed.partID })
      }
      if (messageIDs.size === 0 && partIDs.length === 0) return []

      const parts: SessionV1.Part[] = []
      for (const { messageID, partID } of partIDs) {
        const part = yield* session.getPart({ sessionID, messageID, partID: partID as never })
        if (part) parts.push(part)
      }
      if (messageIDs.size > 0) {
        const messages = yield* session
          .messages({ sessionID, limit: RESOLVE_MESSAGE_LIMIT })
          .pipe(
            Effect.catch((error) =>
              Effect.logDebug("Anchor.resolveRefs: session messages unavailable", { sessionID, error }).pipe(
                Effect.as([]),
              ),
            ),
          )
        for (const message of messages) {
          if (!messageIDs.has(message.info.id)) continue
          parts.push(...message.parts)
        }
      }
      return parts
    })

    // Indexing and search live in @/anchor/content-index: they are pure SQLite and need none of
    // the LLM/agent/provider graph this service holds.
    const searchFTS: Interface["searchFTS"] = Effect.fn("Anchor.searchFTS")(function* (input) {
      return yield* contentIndex.search({ sessionID: input.sessionID, query: input.query, limit: input.limit })
    })

    const index: Interface["index"] = Effect.fn("Anchor.index")(function* (input) {
      return yield* contentIndex.index({ sessionID: input.sessionID, messages: input.messages })
    })

    const runModel = Effect.fn("Anchor.runModel")(function* (input: {
      prompt: string
      sessionID: SessionID
      model: { providerID: string; modelID: string }
    }) {
      const model = yield* provider.getModel(input.model.providerID as never, input.model.modelID as never)
      const compactionAgent = yield* agent.get("compaction")
      const chunks: string[] = []
      yield* llm
        .stream({
          user: {
            id: MessageID.ascending(),
            sessionID: input.sessionID,
            time: { created: Date.now() },
            role: "user",
            agent: compactionAgent.name,
            model: { providerID: model.providerID, modelID: model.id },
          },
          sessionID: input.sessionID,
          system: [],
          small: true,
          tools: {},
          retries: 1,
          messages: [{ role: "user", content: input.prompt }],
          model,
          agent: compactionAgent,
        })
        .pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
            }),
          ),
        )
      return chunks.join("")
    })

    const generate: Interface["generate"] = Effect.fn("Anchor.generate")(function* (input) {
      if (input.messages.length === 0) return undefined
      const availableRefs = collectRefs(input.messages)
      const first = yield* runModel({
        prompt: buildAnchorPrompt(input.messages),
        sessionID: input.sessionID,
        model: input.model,
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("Anchor.generate: model call failed", { cause }).pipe(Effect.as(""))))

      const fallback = (): GeneratedAnchor | undefined => {
        const tree = mechanicalTree(input.messages)
        if (!tree) return undefined
        return { tree, degraded: true }
      }

      // A hard failure (no key, model unreachable) is not something a repair pass can fix, and
      // retrying it just doubles the cost of a failure the caller is about to degrade around.
      if (!first.trim()) return fallback()

      const parsed = parseTree(first)
      if (parsed.success) {
        const validation = validateTree(parsed.value, availableRefs)
        if (validation.valid) return { tree: validation.tree, degraded: false }
      }

      // One repair pass: hand the model its own errors plus the refs it may use.
      const errors = parsed.success ? validationErrors(parsed.value, availableRefs) : ["output is not valid JSON"]
      const repaired = yield* runModel({
        prompt: buildRepairPrompt(errors, availableRefs),
        sessionID: input.sessionID,
        model: input.model,
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("Anchor.generate: repair failed", { cause }).pipe(Effect.as(""))))
      if (!repaired.trim()) return fallback()
      const retry = parseTree(repaired)
      if (!retry.success) {
        yield* Effect.logWarning("Anchor.generate: repair output is not JSON", {
          output: repaired.slice(0, 400),
          firstErrors: validationErrors(first, availableRefs),
        })
        return fallback()
      }
      const validation = validateTree(retry.value, availableRefs)
      if (!validation.valid) {
        yield* Effect.logWarning("Anchor.generate: repaired tree still invalid", {
          missingRefs: validation.missingRefs,
          output: repaired.slice(0, 400),
        })
        return fallback()
      }
      return { tree: validation.tree, degraded: false }
    })

    return { create, get, list, getLatest, resolveRefs, searchFTS, index, generate }
  }),
)

const RESOLVE_MESSAGE_LIMIT = 500

function parseTree(output: string) {
  if (!output.trim()) return { success: false as const, value: undefined }
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    return { success: false as const, value: undefined }
  }
  // Models often wrap JSON in a markdown fence.
  if (value && typeof value === "object" && !("objective" in value)) {
    const text = JSON.stringify(value)
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) {
      try {
        value = JSON.parse(text.slice(start, end + 1))
      } catch {
        /* keep the original value */
      }
    }
  }
  return { success: true as const, value }
}

function validationErrors(value: unknown, availableRefs: ReadonlySet<string>) {
  const errors: string[] = []
  const structural = validateTree(value, availableRefs)
  if (structural.valid) return errors
  if (structural.missingRefs.length > 0) {
    errors.push(`Unknown refs: ${structural.missingRefs.join(", ")}`)
    return errors
  }
  const decoded = Schema.decodeUnknownResult(AnchorTreeSchema)(value)
  errors.push(Result.isSuccess(decoded) ? "Tree structure is invalid" : "Output does not match the anchor schema")
  return errors
}

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Database.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(AnchorContentIndex.defaultLayer),
  ),
)

export const node = LayerNode.make(layer, [
  Database.node,
  Session.node,
  Agent.node,
  Provider.node,
  LLM.node,
  EventV2Bridge.node,
  AnchorContentIndex.node,
])

export * as Anchor from "./anchor"
