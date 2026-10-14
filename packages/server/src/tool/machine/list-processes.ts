import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { exec } from "./exec"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./list-processes.txt"

export const Parameters = Schema.Struct({
  sortBy: Schema.optional(Schema.Literals(["cpu", "memory", "pid"] as const)).annotate({
    description: "Sort processes by cpu (default), memory, or pid",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of processes to return (default 20)",
  }),
})

interface ProcRow {
  pid: number
  cpu: number
  memory: number
  command: string
}

interface ListProcessesMetadata {
  available: boolean
  reason: string
  platform: NodeJS.Platform
  count: number
  sortBy?: "cpu" | "memory" | "pid"
  exitCode: number
}

function pickPsCommand(sort: "cpu" | "memory" | "pid"): { command: string; args: string[] } | undefined {
  if (process.platform === "win32") {
    return { command: "tasklist", args: ["/fo", "csv", "/nh"] }
  }
  const sortFlag = sort === "cpu" ? "-pcpu" : sort === "memory" ? "-pmem" : "pid"
  return { command: "ps", args: ["-eo", "pid,pcpu,pmem,comm", `--sort=${sortFlag}`] }
}

function parsePs(stdout: string, sort: string, limit: number): ProcRow[] {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0)
  const start = process.platform === "win32" ? 0 : 1
  const rows: ProcRow[] = []
  for (const line of lines.slice(start)) {
    if (process.platform === "win32") {
      const m = line.match(/^"([^"]+)","(\d+)","[^"]+","(\d+)","([\d,]+ K)"/)
      if (m) {
        rows.push({
          pid: Number(m[2]),
          cpu: 0,
          memory: parseFloat(m[5].replace(/[,\sK]/g, "")) / 1024,
          command: m[1],
        })
      }
    } else {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 4) {
        const pid = Number(parts[0])
        const cpu = Number(parts[1])
        const memory = Number(parts[2])
        const command = parts.slice(3).join(" ")
        if (!Number.isNaN(pid)) rows.push({ pid, cpu, memory, command })
      }
    }
  }
  void sort
  return rows.slice(0, limit)
}

export const ListProcessesTool = Tool.define(
  "list_processes",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { sortBy?: "cpu" | "memory" | "pid"; limit?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const sort = params.sortBy ?? "cpu"
          const limit = params.limit ?? 20
          const cmd = pickPsCommand(sort)
          if (!cmd) {
            const meta: ListProcessesMetadata = {
              available: false,
              reason: "no-ps-binary",
              platform: process.platform,
              count: 0,
              sortBy: sort,
              exitCode: -1,
            }
            return {
              output: `Process listing unavailable on ${process.platform}.`,
              title: "Processes",
              metadata: meta,
            }
          }
          const result = yield* exec(spawner, cmd.command, cmd.args, 5000)
          const rows = parsePs(result.stdout, sort, limit)
          const meta: ListProcessesMetadata = {
            available: true,
            reason: "",
            platform: process.platform,
            count: rows.length,
            sortBy: sort,
            exitCode: result.exitCode,
          }
          return {
            output: JSON.stringify(rows, null, 2),
            title: `${rows.length} processes (top by ${sort})`,
            metadata: meta,
          }
        }),
    }
  }),
)
