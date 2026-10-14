import { Effect, Schema } from "effect"
import { Anchor } from "../../anchor/anchor"
import * as Tool from "../tool"
import DESCRIPTION from "./search.txt"

/** Plan's cap: enough to see whether a thread exists, few enough to stay cheap. */
const LIMIT = 8

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description:
      "Words to search for. Plain words work; identifiers, paths and error strings work well because the exact text is indexed. This is a full-text match, not a semantic one - search for the words that would literally appear.",
  }),
})

type Metadata = {
  query: string
}

export const SearchMemoryTool = Tool.define<typeof Parameters, Metadata, Anchor.Service>(
  "search_memory",
  Effect.gen(function* () {
    const anchor = yield* Anchor.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "search_memory",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const trimmed = params.query.trim()
          if (!trimmed) {
            return {
              title: "empty query",
              output: "Provide at least one word to search for.",
              metadata: { query: params.query },
            }
          }

          const hits = yield* anchor.searchFTS({ sessionID: ctx.sessionID, query: trimmed, limit: LIMIT })

          if (hits.length === 0) {
            return {
              title: `no matches for "${trimmed}"`,
              output: [
                `Nothing in this session matches "${trimmed}".`,
                ``,
                `This means the words are absent, not that the topic was never covered - compaction drops`,
                `text that had nothing distinctive in it. Try fewer or more distinctive words, or an exact`,
                `identifier or error string from the topic.`,
              ].join("\n"),
              metadata: { query: params.query },
            }
          }

          const body = hits
            .map((hit, i) => `${i + 1}. ref ${hit.ref}\n   ${hit.snippet.replace(/<\/?b>/g, "").trim()}`)
            .join("\n")

          yield* ctx.metadata({ title: `${hits.length} match(es)`, metadata: { query: params.query } })

          return {
            title: `${hits.length} match(es) for "${trimmed}"`,
            output: [
              `${hits.length} match(es) for "${trimmed}", most relevant first:`,
              ``,
              body,
              ``,
              `Read the full text of any ref worth acting on with recall_context.`,
            ].join("\n"),
            metadata: { query: params.query },
          }
        }),
    }
  }),
)
