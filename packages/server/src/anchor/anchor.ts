// packages/server/src/anchor/anchor.ts
// Anchor service: write/read/query linktree anchors, resolve refs to original parts.
// Draft-10 P1 — lossless context (replaces lossy compaction summary with a structured index).

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Database } from "@diveeoi/db/database/database"
import { SessionSchema, SessionV1 } from "@diveeoi/db/v1/session"
import { Context, Effect, Layer, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { Compaction } from "@/session/compaction"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Config } from "@/config/config"
import { Features } from "@/features"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@diveeoi/db/event"
import { useAdaptiveTargets } from "@diveeoi/db/adaptive"
import { Prompt } from "@/session/prompt"
import * as Token from "@/util/token"
import { Agent } from "@/agent/agent"
import { CompactionEvent } from "@diveeoi/db/session/event"

import PROMPT_ANCHOR from "./prompt/anchor.txt"

export const Event = {
  Anchored: EventV2.define({
    type: "anchor.created",
    schema: {
      sessionID: SessionSchema.ID,
      anchorID: Schema.String,
    },
  }),
}

export const Info = Schema.Struct({
  id: Schema.String,
  session_id: SessionSchema.ID,
  epoch: Schema.Number,
  root_ref: Schema.String,
  tree_json: Schema.Unknown,
  token_estimate: Schema.optional(Schema.Number),
  degraded: Schema.Boolean,
  created_at: Schema.Number,
})
export type Info = typeof Info.Type

export interface AnchorRef {
  readonly anchor_id: string
  readonly ref: string
  readonly section: "objective" | "decisions" | "files" | "open_questions" | "status" | "open_todos"
  readonly label: string
  readonly ordinal: number
}

export interface AnchorTree {
  objective: { ref: string }
  decisions: Array<{ ref: string; label: string }>
  files: Array<{ ref: string; label: string }>
  open_questions: Array<{ ref: string; label: string }>
  status: { ref: string; label: string }
  open_todos?: Array<{ content: string }>
}

export interface Interface {
  readonly create: (input: {
    sessionID: SessionID
    epoch: number
    rootRef: string
    tree: AnchorTree
  }) => Effect.Effect<Info>
  readonly get: (anchorID: string) => Effect.Effect<Info | undefined>
  readonly list: (sessionID: SessionID, limit?: number) => Effect.Effect<ReadonlyArray<Info>>
  readonly getLatest: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly resolveRefs: (refs: ReadonlyArray<string>, sessionID: SessionID) => Effect.Effect<ReadonlyArray<SessionV1.Part>>
  readonly searchFTS: (input: {
    sessionID: SessionID
    query: string
    limit?: number
  }) => Effect.Effect<ReadonlyArray<{ ref: string; snippet: string; rank: number }>>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/Anchor") {}

export const use = (): Effect.Effect<Interface, never, Service> => Effect.service(Service)

const live = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* Session.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const flags = yield* InstanceState.useEffect(
      InstanceState.make(() => Effect.succeed({} as { compactedOnce: boolean })),
    )

    const runLlm = Effect.fn("Anchor.runLlm")(function* (input: {
      prompt: string
      model: { providerID: string; modelID: string }
      sessionID: SessionID
    }) {
      const ag = yield* Agent.Service
      const compactionAgent = yield* ag.get("compaction")
      const stream = yield* llm.stream({
        agent: compactionAgent,
        user: {
          id: MessageID.ascending(),
          sessionID: input.sessionID,
          time: { created: Date.now() },
          role: "user",
          agent: compactionAgent.name,
          model: { providerID: input.model.providerID, modelID: input.model.modelID },
        },
        system: [],
        small: true,
        tools: {},
        model: { providerID: input.model.providerID, modelID: input.model.modelID },
        sessionID: input.sessionID,
        retries: 1,
        messages: [{ role: "user", content: input.prompt }],
      })
      return yield* Stream.runCollect(stream).pipe(
        Effect.map((chunks) => chunks.map((c) => (c as any).text ?? "").join("")),
        Effect.catchCause((cause) => Effect.logError("anchor llm failed", { cause }).pipe(Effect.as([]))),
      )
    })

    const validateTree = (tree: unknown, providedRefs: Set<string>): tree is AnchorTree => {
      if (!tree || typeof tree !== "object") return false
      const t = tree as Record<string, unknown>
      if (!t.objective || typeof t.objective !== "object" || !(t.objective as any).ref) return false
      if (!Array.isArray(t.decisions) || !Array.isArray(t.files) || !Array.isArray(t.open_questions) || !t.status) return false
      // Verify every ref exists in the provided set
      const allRefs = [
        (t.objective as any).ref,
        ...(t.decisions as any[]).map((d) => d.ref),
        ...(t.files as any[]).map((f) => f.ref),
        ...(t.open_questions as any[]).map((q) => q.ref),
        (t.status as any).ref,
      ]
      for (const ref of allRefs) {
        if (!providedRefs.has(ref) && ref !== "msg:__NONE__") return false
      }
      return true
    }

    const repairTree = Effect.fn("Anchor.repairTree")(function* (input: {
      tree: unknown
      errors: string[]
      providedRefs: Set<string>
      messages: SessionV1.WithParts[]
      model: { providerID: string; modelID: string }
      sessionID: SessionID
    }) {
      const repairPrompt = `The previous anchor output was invalid. Errors:\n${input.errors.join("\n")}\n\nProvided refs (use ONLY these):\n${[...input.providedRefs].join(", ")}\n\nGenerate a VALID anchor tree as JSON matching the schema. No prose.`
      const stream = yield* llm.stream({
        agent: (yield* Agent.Service).get("compaction").pipe(Effect.orDie),
        user: { id: MessageID.ascending(), sessionID: input.sessionID, time: { created: Date.now() }, role: "user", agent: "compaction", model: input.model },
        system: [],
        small: true,
        tools: {},
        model: input.model,
        sessionID: input.sessionID,
        retries: 1,
        messages: [{ role: "user", content: repairPrompt }],
      })
      const text = yield* Stream.runCollect(stream).pipe(Effect.map((c) => c.map((x) => (x as any).text ?? "").join("")))
      try {
        const parsed = JSON.parse(text[0] ?? "{}")
        if (validateTree(parsed, input.providedRefs)) return parsed as AnchorTree
      } catch {}
      return null
    })

    const buildAnchorPrompt = (messages: SessionV1.WithParts[], model: { providerID: string; modelID: string }) => {
      const withIds = messages.map((msg) => ({
        info: { id: msg.info.id, role: msg.info.role, parentID: msg.info.parentID },
        parts: msg.parts.map((p) => ({ id: p.id, type: p.type, text: p.text ?? "", tool: (p as any).tool ?? undefined, state: p.state ?? {} })),
      }))
      return `${PROMPT_ANCHOR}\n\nMessages:\n${JSON.stringify(withIds, null, 2)}`
    }

    const collectRefs = (messages: SessionV1.WithParts[]): Set<string> => {
      const set = new Set<string>()
      for (const msg of messages) {
        set.add(`msg:${msg.info.id}`)
        for (const part of msg.parts) {
          set.add(`part:${part.id}`)
          if ((part as any).tool) set.add(`tool:${msg.info.id}:${part.id}`)
        }
      }
      return set
    }

    const create = Effect.fn("Anchor.create")(function* (input: {
      sessionID: SessionID
      epoch: number
      rootRef: string
      tree: AnchorTree
    }) {
      const tokenEstimate = Token.estimate(JSON.stringify(input.tree))
      const id = `anc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      yield* db.run(
        `INSERT INTO session_anchor (id, session_id, epoch, root_ref, tree_json, token_estimate, degraded, time_created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.sessionID, input.epoch, input.rootRef, JSON.stringify(input.tree), tokenEstimate, input.tree.objective.ref === "msg:__NONE__" ? 1 : 0, Date.now()],
      )
      const refs: Array<[string, string, string, string, number]> = []
      let ord = 0
      const push = (section: AnchorTree[keyof AnchorTree], sectionName: AnchorRef["section"]) => {
        if (!Array.isArray(section)) return
        for (const item of section) {
          refs.push([id, item.ref, sectionName, item.label, ord++])
        }
      }
      push(input.tree.decisions, "decisions")
      push(input.tree.files, "files")
      push(input.tree.open_questions, "open_questions")
      push([input.tree.status], "status")
      push((input.tree.open_todos ?? []).map((t) => ({ ref: `todo:${t.content}`, label: t.content })), "open_todos")
      if (refs.length) {
        const placeholders = refs.map(() => "(?, ?, ?, ?, ?)").join(", ")
        const values = refs.flat()
        yield* db.run(
          `INSERT INTO session_anchor_ref (anchor_id, ref, section, label, ordinal) VALUES ${placeholders}`,
          values,
        )
      }
      yield* events.publish(Event.Anchored, { sessionID: input.sessionID, anchorID: id })
      return { id, session_id: input.sessionID, epoch: input.epoch, root_ref: input.rootRef, tree_json: input.tree, token_estimate: tokenEstimate, degraded: input.tree.objective.ref === "msg:__NONE__", created_at: Date.now() }
    })

    const get = Effect.fn("Anchor.get")(function* (anchorID: string) {
      const row = yield* db.get<{ id: string; session_id: SessionID; epoch: number; root_ref: string; tree_json: string; token_estimate: number | null; degraded: number; time_created: number }>(
        `SELECT * FROM session_anchor WHERE id = ?`,
        [anchorID],
      )
      if (!row) return undefined
      return { id: row.id, session_id: row.session_id, epoch: row.epoch, root_ref: row.root_ref, tree_json: JSON.parse(row.tree_json), token_estimate: row.token_estimate ?? undefined, degraded: row.degraded === 1, created_at: row.time_created }
    })

    const list = Effect.fn("Anchor.list")(function* (sessionID: SessionID, limit = 50) {
      const rows = yield* db.all<{ id: string; session_id: SessionID; epoch: number; root_ref: string; tree_json: string; token_estimate: number | null; degraded: number; time_created: number }>(
        `SELECT * FROM session_anchor WHERE session_id = ? ORDER BY epoch DESC LIMIT ?`,
        [sessionID, limit],
      )
      return rows.map((row) => ({ id: row.id, session_id: row.session_id, epoch: row.epoch, root_ref: row.root_ref, tree_json: JSON.parse(row.tree_json), token_estimate: row.token_estimate ?? undefined, degraded: row.degraded === 1, created_at: row.time_created }))
    })

    const getLatest = Effect.fn("Anchor.getLatest")(function* (sessionID: SessionID) {
      const row = yield* db.get<{ id: string; session_id: SessionID; epoch: number; root_ref: string; tree_json: string; token_estimate: number | null; degraded: number; time_created: number }>(
        `SELECT * FROM session_anchor WHERE session_id = ? ORDER BY epoch DESC LIMIT 1`,
        [sessionID],
      )
      if (!row) return undefined
      return { id: row.id, session_id: row.session_id, epoch: row.epoch, root_ref: row.root_ref, tree_json: JSON.parse(row.tree_json), token_estimate: row.token_estimate ?? undefined, degraded: row.degraded === 1, created_at: row.time_created }
    })

    const resolveRefs = Effect.fn("Anchor.resolveRefs")(function* (refs: ReadonlyArray<string>, sessionID: SessionID) {
      // Refs are "msg:<id>" | "part:<id>" | "tool:<msgId>:<partId>"
      const msgIds = new Set<string>()
      const partIds = new Set<string>()
      for (const ref of refs) {
        if (ref.startsWith("msg:")) msgIds.add(ref.slice(4))
        else if (ref.startsWith("part:")) partIds.add(ref.slice(5))
        else if (ref.startsWith("tool:")) partIds.add(ref.split(":")[2] ?? "")
      }
      const parts: SessionV1.Part[] = []
      if (msgIds.size) {
        const msgs = yield* session.messages({ sessionID, ids: [...msgIds] })
        for (const m of msgs) parts.push(...m.parts)
      }
      if (partIds.size) {
        const p = yield* session.parts({ sessionID, ids: [...partIds] })
        parts.push(...p)
      }
      return parts
    })

    const searchFTS = Effect.fn("Anchor.searchFTS")(function* (input: {
      sessionID: SessionID
      query: string
      limit?: number
    }) {
      // FTS5 MATCH with BM25 rank; snippet() for context
      const rows = yield* db.all<{ ref: string; text: string }>(
        `SELECT ref, snippet(session_content_fts, 2, '<b>', '</b>', '...', 12) as snippet, bm25(session_content_fts) as rank
         FROM session_content_fts
         WHERE session_id = ? AND session_content_fts MATCH ?
         ORDER BY rank LIMIT ?`,
        [input.sessionID, input.query, input.limit ?? 8],
      )
      return rows.map((r) => ({ ref: r.ref, snippet: r.snippet, rank: Number(r.rank) }))
    })

    return { create, get, list, getLatest, resolveRefs, searchFTS }
  }),
)

export const defaultLayer = Layer.suspend(() =>
  live.pipe(
    Layer.provide(Database.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Compaction.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(SessionMemoryIntegration.defaultLayer),
    Layer.provide(Prompt.defaultLayer),
  ),
)

export const node = LayerNode.make(live, [Database.node, Session.node, Compaction.node, Config.node, Provider.node, LLM.node, EventV2Bridge.node, Agent.node, SessionMemoryIntegration.node, Prompt.node])

export * as Anchor from "./anchor"