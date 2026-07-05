import { Effect, Schema } from "effect"
import { Tool } from "@/tool/tool"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"
import type { JSONSchema7 } from "@ai-sdk/provider"

export const getCtx7Defs = Effect.fn("Setup.Ctx7.defs")(function* () {
  if (process.env.DIVEEOI_CTX7_DISABLED === "1") return [] as Tool.Def[]

  const cfg = yield* Config.Service
  const config = yield* cfg.get()
  const builtin = config.builtin?.ctx7

  if (builtin?.enabled === false) return [] as Tool.Def[]

  const apiKey = builtin?.api_key ?? process.env.UPSTASH_CONTEXT7_API_KEY
  if (!apiKey) return [] as Tool.Def[]

  const mod: any = yield* Effect.promise(() => import("@upstash/context7-tools-ai-sdk")).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  )
  if (!mod) return [] as Tool.Def[]

  const ctx7ToolsRecord: Record<string, any> =
    typeof mod.context7Tools === "function" ? mod.context7Tools({ apiKey }) : (mod.context7Tools ?? {})

  const truncate = yield* Truncate.Service
  const agents = yield* Agent.Service

  const defs: Tool.Def[] = []
  for (const [name, sdkTool] of Object.entries(ctx7ToolsRecord)) {
    const toolId = `ctx7_${name}`
    defs.push({
      id: toolId,
      description: sdkTool.description ?? "Context7 retrieval tool",
      parameters: Schema.Unknown,
      jsonSchema: extractJsonSchema(sdkTool),
      execute: ((args: unknown, ctx: Tool.Context) => {
        const attrs = { "tool.name": toolId, "session.id": ctx.sessionID }
        return Effect.gen(function* () {
          const result = (yield* Effect.promise(() => sdkTool.execute!(args, { toolCallId: ctx.callID })).pipe(
            Effect.catch((err: Error) =>
              Effect.succeed({
                content: [{ type: "text" as const, text: `Context7 unavailable: ${err.message}. The model should fall back to web search.` }],
              }),
            ),
          )) as { content?: Array<{ text?: string }> }
          const text = result.content?.map((c: any) => c.text).filter(Boolean).join("\n") ?? ""
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(text, {}, agent)
          return {
            title: name,
            output: truncated.content,
            metadata: {
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          } as Tool.ExecuteResult
        }).pipe(
          Effect.orDie,
          Effect.withSpan("Tool.execute", { attributes: attrs }),
        ) as Effect.Effect<Tool.ExecuteResult>
      }) as Tool.Def["execute"],
    })
  }

  return defs
})

export const checkCtx7Update = Effect.fn("Setup.Ctx7.checkUpdate")(function* () {
  const result = yield* Effect.promise(async () => {
    try {
      const { execSync } = await import("child_process")
      const out = execSync("npm outdated @upstash/context7-tools-ai-sdk 2>/dev/null", {
        encoding: "utf-8",
        timeout: 10_000,
      })
        .toString()
        .trim()
      return out || undefined
    } catch {
      return undefined
    }
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (result) {
    yield* Effect.logInfo("ctx7 SDK update available. Run: bun update @upstash/context7-tools-ai-sdk", {
      details: result,
    })
  } else {
    yield* Effect.logDebug("ctx7 SDK is up to date")
  }
})

function extractJsonSchema(sdkTool: any): JSONSchema7 | undefined {
  if (sdkTool.jsonSchema) return sdkTool.jsonSchema
  return undefined
}
