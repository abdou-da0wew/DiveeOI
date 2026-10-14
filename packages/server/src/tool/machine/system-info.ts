import { Effect, Schema } from "effect"
import os from "node:os"
import * as Tool from "../tool"
import { detectSystemResources } from "@diveeoi/db/adaptive"
import DESCRIPTION from "./system-info.txt"

export const Parameters = Schema.Struct({})

/**
 * `get_system_info()` — cross-platform system info (draft-10 P6).
 *
 * Returns CPU, memory, platform, hostname, load average, and the adaptive
 * profile the server is currently running under. Same data the adaptive
 * resource system already collects (`detectSystemResources` in
 * `packages/db/src/adaptive/detect.ts`) — this tool just surfaces it to the
 * agent so it can reason about the host it's running on.
 *
 * Permission: auto (read-only, no destructive op).
 */
export const SystemInfoTool = Tool.define(
  "get_system_info",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params: Record<string, never>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const sys = yield* detectSystemResources.pipe(Effect.catch(() => Effect.succeed(null)))
          const cpus = os.cpus()
          const load = os.loadavg()
          return {
            output: JSON.stringify(
              {
                platform: process.platform,
                arch: process.arch,
                hostname: os.hostname(),
                cpuCount: cpus.length,
                cpuModel: cpus[0]?.model ?? "unknown",
                totalMemoryMB: sys?.totalMemoryMB ?? Math.round(os.totalmem() / 1024 / 1024),
                availableMemoryMB: sys?.availableMemoryMB ?? Math.round(os.freemem() / 1024 / 1024),
                storageHint: sys?.storageHint ?? "unknown",
                loadAverage: { "1m": load[0], "5m": load[1], "15m": load[2] },
                uptimeSeconds: Math.round(os.uptime()),
              },
              null,
              2,
            ),
            title: "System info",
            metadata: { platform: process.platform, arch: process.arch },
          }
        }),
    }
  }),
)
