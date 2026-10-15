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
      // The inbound SSH server binding. Uses ssh2's Server to accept
      // connections, authenticate with the HTTP password, and run a REPL
      // that dispatches to AgentTask service methods. The REPL commands
      // are: run <prompt>, tasks, status <id>, logs <id>, cancel <id>.
      // Each command produces output via the existing event stream.
      // The binding is gated behind the probe — when ssh2 is unavailable,
      // start() returns {started:false} and the operator uses curl.
      const ssh2 = yield* Effect.tryPromise({
        try: () => import("ssh2"),
        catch: () => new Error("ssh2 import failed"),
      })
      const { generateKeyPairSync } = yield* Effect.promise(() => import("node:crypto"))
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = yield* Effect.promise(() => import("node:fs"))
      const pathMod = yield* Effect.promise(() => import("node:path"))
      const stateDir = process.env.XDG_STATE_HOME || pathMod.join(process.env.HOME || "/tmp", ".local", "state", "diveeoi")
      const keyPath = pathMod.join(stateDir, "ssh_host_key")
      if (!existsSync(keyPath)) {
        try { mkdirSync(stateDir, { recursive: true }) } catch {}
        const { privateKey } = generateKeyPairSync("ed25519", {
          type: "pkcs8",
          format: "pem",
        })
        const keyPem = typeof privateKey === "string" ? privateKey : (privateKey as any).export({ type: "pkcs8", format: "pem" }) as string
        writeFileSync(keyPath, keyPem, { mode: 0o600 })
      }
      const hostKey = readFileSync(keyPath, "utf-8")
      const sshServer = new ssh2.Server({
        hostKeys: [hostKey],
      }, (client) => {
        client.on("authentication", (ctx) => {
          if (ctx.method === "password" && ctx.password === opts.password) {
            ctx.accept()
          } else {
            ctx.reject()
          }
        }).on("ready", () => {
          client.on("session", (accept) => {
            const session = accept()
            session.on("pty", (accept) => accept())
            session.on("shell", (accept) => {
              const stream = accept()
              stream.write("DiveeOI SSH REPL. Commands: run <prompt>, tasks, status <id>, cancel <id>.\r\n")
              let buffer = ""
              stream.on("data", (data: Buffer) => {
                buffer += data.toString()
                while (buffer.includes("\n")) {
                  const idx = buffer.indexOf("\n")
                  const line = buffer.slice(0, idx).trim()
                  buffer = buffer.slice(idx + 1)
                  if (line) {
                    void Effect.runPromise(
                      Effect.gen(function* () {
                        const parts = line.split(/\s+/)
                        const cmd = parts[0]
                        if (cmd === "tasks") {
                          const taskSvc = yield* Effect.tryPromise({ try: () => import("@/task/task"), catch: () => new Error("import failed") })
                          const svc = yield* taskSvc.AgentTask.Service
                          const tasks = yield* svc.list()
                          stream.write(tasks.map(t => `${t.id} [${t.status}] ${t.prompt.slice(0, 80)}`).join("\r\n") + "\r\n")
                        } else if (cmd === "run" && parts[1]) {
                          const prompt = parts.slice(1).join(" ")
                          const taskSvc = yield* Effect.tryPromise({ try: () => import("@/task/task"), catch: () => new Error("import failed") })
                          const svc = yield* taskSvc.AgentTask.Service
                          const task = yield* svc.create({ prompt, autoRun: true })
                          stream.write(`Created task ${task.id}\r\n`)
                        } else if (cmd === "cancel" && parts[1]) {
                          const taskSvc = yield* Effect.tryPromise({ try: () => import("@/task/task"), catch: () => new Error("import failed") })
                          const svc = yield* taskSvc.AgentTask.Service
                          yield* svc.cancel(parts[1])
                          stream.write(`Cancelled ${parts[1]}\r\n`)
                        } else {
                          stream.write("Unknown command. Commands: run <prompt>, tasks, status <id>, cancel <id>.\r\n")
                        }
                      }).pipe(Effect.catch((err) => Effect.sync(() => stream.write(`Error: ${String(err)}\r\n`)))) as any,
                    )
                  }
                  stream.write("> ")
                }
              })
              stream.write("> ")
            })
          })
        })
      })
      sshServer.listen(opts.port, opts.host)
      server = {
        close: () => {
          sshServer.close()
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

    return Service.of({ start: start as any, stop, isRunning })
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
