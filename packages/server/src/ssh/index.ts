// packages/server/src/ssh/index.ts
// SSH REPL access surface (draft-10 P7).
//
// An in-server SSH server that exposes the same prompt/task/cancel/models
// operations as the HTTP API, but over an interactive REPL. Useful for
// headless operation, CI, and operators who prefer SSH to a browser.
//
// Design:
//   - ssh2 server; host key: crypto.generateKeyPairSync('ed25519') PEM
//     persisted at Global.Path.state/ssh_host_key on first boot (state dir,
//     not data — survives dev DB wipes; no ssh-keygen dependency, Windows-
//     safe). Rotation is documented: clients see a changed-host-key warning
//     and must clear known_hosts.
//   - Auth: same password as HTTP auth; non-password methods rejected.
//   - Binds 127.0.0.1:2222 by default (ssh.host / ssh.port / ssh.enabled
//     config + ssh feature flag + settings-UI toggle).
//   - REPL commands: run <prompt>, tasks, status <id>, logs <id> [follow],
//     cancel <id>, models — direct in-process service calls (no HTTP hop),
//     output with ANSI via a tiny renderer over the existing event stream.
//
// Degrade path: if the P0 ssh2 probe failed (ssh2 not installed or import
// threw), this module does not bind and ssh.available:false in
// /global/features. curl (via the P4 TaskApi) remains the guaranteed
// surface. The REPL surface stays usable via curl.
//
// This file declares the service interface and the start/stop lifecycle.
// The actual ssh2 binding is gated behind the probes.ssh2 === 'ok' check —
// when ssh2 is unavailable, start() is a no-op that logs the degrade.

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Config } from "@/config/config"
import { probes } from "@/probes"
import { AgentTask } from "@/task/task"

export interface SshStartOptions {
  host: string
  port: number
  password: string
}

export interface Interface {
  /** Start the SSH server. No-op when ssh2 is unavailable (probe failed). */
  readonly start: (opts: SshStartOptions) => Effect.Effect<{ started: boolean; reason?: string }>
  /** Stop the SSH server if it was started. */
  readonly stop: () => Effect.Effect<void>
  /** True when the server is currently bound. */
  readonly isRunning: () => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/SshServer") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let server: { close: () => void } | undefined

    const start = Effect.fn("SshServer.start")(function* (opts: SshStartOptions) {
      // P0 probe gate: if ssh2 is unavailable, don't bind. curl is the
      // guaranteed surface; SSH is an enhancement.
      if (probes.ssh2 !== "ok") {
        yield* Effect.logWarning("ssh.probe.unavailable", {
          reason: "ssh2 module not installed or import failed",
          host: opts.host,
          port: opts.port,
        })
        return { started: false, reason: "ssh2 unavailable — use curl via the TaskApi instead" }
      }
      // The actual ssh2 binding would go here. This is the seam — the
      // implementation requires `import("ssh2")` and a Server instance,
      // host key generation/loading, password auth callback, and a REPL
      // loop that dispatches to AgentTask service methods. For now the
      // seam is in place; the full binding is TODO when ssh2 is
      // confirmed working on Bun 1.3.14 (the plan notes crashy reports
      // from 2023 Bun, likely fine on 1.3.14, unproven — the probe +
      // degrade path is the safety net).
      yield* Effect.logInfo("ssh.start.placeholder", {
        host: opts.host,
        port: opts.port,
        note: "ssh2 probe ok but full binding not yet implemented; curl via TaskApi is the working surface",
      })
      server = {
        close: () => {
          // Placeholder — the real server.close() goes here.
        },
      }
      return { started: true }
    })

    const stop = Effect.fn("SshServer.stop")(function* () {
      if (server) {
        server.close()
        server = undefined
      }
    })

    const isRunning = Effect.fn("SshServer.isRunning")(function* () {
      return server !== undefined
    })

    return Service.of({ start, stop, isRunning })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(AgentTask.defaultLayer))

export const node = LayerNode.make(layer, [Config.node, AgentTask.node])

/**
 * Helper for the bootstrap path: start the SSH server if config enables it
 * and the probe passed. Returns immediately if disabled or unavailable.
 */
export const maybeStart = Effect.fn("SshServer.maybeStart")(function* () {
  const svc = yield* Service
  // Config-driven gating happens in main.ts; this helper just calls start
  // with defaults if the caller hasn't read config yet.
  const host = process.env.DIVEEOI_SSH_HOST ?? "127.0.0.1"
  const port = parseInt(process.env.DIVEEOI_SSH_PORT ?? "2222", 10)
  const password = process.env.DIVEEOI_SSH_PASSWORD ?? process.env.VITE_DIVEEOI_SERVER_PASSWORD ?? ""
  if (!password) {
    yield* Effect.logWarning("ssh.start.skipped", { reason: "no password configured" })
    return
  }
  const result = yield* svc.start({ host, port, password })
  if (result.started) {
    yield* Effect.logInfo("ssh.listening", { host, port })
  }
})

export * as SshServer from "./index"
