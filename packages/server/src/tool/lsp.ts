import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import path from "path"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./lsp.txt"
import { InstanceState } from "@/effect/instance-state"
import { pathToFileURL } from "url"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@diveeoi/db/fs-util"
import type { Diagnostic as LSPDiagnostic } from "@/lsp/client"

const operations = [
  "diagnostics",
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

/** Operations that operate on a whole file (or the workspace) and need no line/character. */
const fileLevel = new Set<string>(["diagnostics", "documentSymbol", "workspaceSymbol"])

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The LSP operation to perform" }),
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: "The line number (1-based, as shown in editors). Required by position-based operations.",
    }),
  ),
  character: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: "The character offset (1-based, as shown in editors). Required by position-based operations.",
    }),
  ),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query for workspaceSymbol. Empty string requests all symbols.",
  }),
})

export const LspTool = Tool.define(
  "lsp",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(instance.directory, args.filePath)
          yield* assertExternalDirectoryEffect(ctx, file)
          if (!fileLevel.has(args.operation) && (args.line === undefined || args.character === undefined)) {
            throw new Error(`Operation ${args.operation} requires line and character`)
          }
          const meta = fileLevel.has(args.operation)
            ? args.operation === "workspaceSymbol"
              ? { operation: args.operation }
              : { operation: args.operation, filePath: file }
            : { operation: args.operation, filePath: file, line: args.line, character: args.character }
          yield* ctx.ask({
            permission: "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: meta,
          })

          const uri = pathToFileURL(file).href
          const position = { file, line: (args.line ?? 1) - 1, character: (args.character ?? 1) - 1 }
          const relPath = path.relative(instance.worktree, file)
          const detail = !fileLevel.has(args.operation)
            ? `${relPath}:${args.line}:${args.character}`
            : args.operation === "workspaceSymbol"
              ? ""
              : relPath
          const title = detail ? `${args.operation} ${detail}` : args.operation

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)

          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, "document")

          const result: unknown[] = yield* (() => {
            switch (args.operation) {
              case "diagnostics": {
                return Effect.map(lsp.diagnostics(), (all) => all[FSUtil.normalizePath(file)] ?? [])
              }
              case "goToDefinition":
                return lsp.definition(position)
              case "findReferences":
                return lsp.references(position)
              case "hover":
                return lsp.hover(position)
              case "documentSymbol":
                return lsp.documentSymbol(uri)
              case "workspaceSymbol":
                return lsp.workspaceSymbol(args.query ?? "")
              case "goToImplementation":
                return lsp.implementation(position)
              case "prepareCallHierarchy":
                return lsp.prepareCallHierarchy(position)
              case "incomingCalls":
                return lsp.incomingCalls(position)
              case "outgoingCalls":
                return lsp.outgoingCalls(position)
            }
          })()

          const output =
            args.operation === "diagnostics"
              ? result.length === 0
                ? `No LSP diagnostics for ${relPath}`
                : result.map((item) => LSP.Diagnostic.pretty(item as LSPDiagnostic)).join("\n")
              : result.length === 0
                ? `No results found for ${args.operation}`
                : JSON.stringify(result, null, 2)

          return {
            title,
            metadata: { result },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
