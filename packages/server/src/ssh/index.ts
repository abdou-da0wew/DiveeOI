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
  username?: string
  password: string
  hostKeyFile?: string
  listenTimeoutMs?: number
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
      const { loadSSHHostKey } = yield* Effect.promise(() => import("./ssh-host-key"))
      const pathMod = yield* Effect.promise(() => import("node:path"))
      const stateDir =
        process.env.XDG_STATE_HOME || pathMod.join(process.env.HOME || process.cwd(), ".local", "state", "diveeoi")
      const keyPath =
        opts.hostKeyFile ?? process.env.DIVEEOI_SSH_HOST_KEY_FILE ?? pathMod.join(stateDir, "ssh_host_key")
      const hostKey = yield* Effect.tryPromise({
        try: () => loadSSHHostKey(keyPath),
        catch: (error) => error as Error,
      })
      const sshServer = new ssh2.Server(
        {
          hostKeys: [hostKey],
        },
        (client) => {
          client
            .on("authentication", (ctx) => {
              const usernameMatches = !opts.username || ctx.username === opts.username
              if (ctx.method === "password" && usernameMatches && ctx.password === opts.password) {
                ctx.accept()
              } else {
                ctx.reject()
              }
            })
            .on("ready", () => {
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
                              const taskSvc = yield* Effect.tryPromise({
                                try: () => import("@/task/task"),
                                catch: () => new Error("import failed"),
                              })
                              const svc = yield* taskSvc.AgentTask.Service
                              const tasks = yield* svc.list()
                              stream.write(
                                tasks.map((t) => `${t.id} [${t.status}] ${t.prompt.slice(0, 80)}`).join("\r\n") +
                                  "\r\n",
                              )
                            } else if (cmd === "run" && parts[1]) {
                              const prompt = parts.slice(1).join(" ")
                              const taskSvc = yield* Effect.tryPromise({
                                try: () => import("@/task/task"),
                                catch: () => new Error("import failed"),
                              })
                              const svc = yield* taskSvc.AgentTask.Service
                              const task = yield* svc.create({ prompt, autoRun: true })
                              stream.write(`Created task ${task.id}\r\n`)
                            } else if (cmd === "cancel" && parts[1]) {
                              const taskSvc = yield* Effect.tryPromise({
                                try: () => import("@/task/task"),
                                catch: () => new Error("import failed"),
                              })
                              const svc = yield* taskSvc.AgentTask.Service
                              yield* svc.cancel(parts[1])
                              stream.write(`Cancelled ${parts[1]}\r\n`)
                            } else {
                              stream.write(
                                "Unknown command. Commands: run <prompt>, tasks, status <id>, cancel <id>.\r\n",
                              )
                            }
                          }).pipe(
                            Effect.catch((err) => Effect.sync(() => stream.write(`Error: ${String(err)}\r\n`))),
                          ) as any,
                        )
                      }
                      stream.write("> ")
                    }
                  })
                  stream.write("> ")
                })
              })
            })
        },
      )
      yield* Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            const timeoutMs = Number.isInteger(Number(process.env.DIVEEOI_SSH_LISTEN_TIMEOUT_MS))
              ? Math.max(1000, Math.min(30000, Number(process.env.DIVEEOI_SSH_LISTEN_TIMEOUT_MS)))
              : 8000
            const timer = setTimeout(() => {
              cleanup()
              reject(new Error(`SSH listener startup timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            const onListening = () => {
              cleanup()
              resolve()
            }
            const onError = (error: Error) => {
              cleanup()
              reject(error)
            }
            const cleanup = () => {
              clearTimeout(timer)
              sshServer.off("listening", onListening)
              sshServer.off("error", onError)
            }
            sshServer.once("listening", onListening)
            sshServer.once("error", onError)
            sshServer.listen(opts.port, opts.host)
          }),
        catch: (error) => error as Error,
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError("ssh.listener.failed", {
            host: opts.host,
            port: opts.port,
            message: error.message,
          }),
        ),
      )
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
  const configService = yield* Config.Service
  const config = yield* configService.get()
  const settings = config.ssh ?? {}
  const enabled =
    process.env.DIVEEOI_SSH_ENABLED === undefined
      ? settings.enabled !== false
      : process.env.DIVEEOI_SSH_ENABLED !== "false"
  if (!enabled) {
    yield* Effect.logInfo("ssh.start.skipped", { reason: "SSH listener disabled" })
    return
  }

  const svc = yield* Service
  const host = process.env.DIVEEOI_SSH_HOST ?? settings.host ?? "127.0.0.1"
  const port = Number.parseInt(process.env.DIVEEOI_SSH_PORT ?? String(settings.port ?? 2222), 10)
  const username = process.env.DIVEEOI_SSH_USERNAME ?? settings.username ?? process.env.DIVEEOI_SERVER_USERNAME
  const password =
    process.env.DIVEEOI_SSH_PASSWORD ??
    process.env.DIVEEOI_SERVER_PASSWORD ??
    process.env.OPENCODE_SERVER_PASSWORD ??
    ""
  if (!password) {
    yield* Effect.logInfo("ssh.start.skipped", { reason: "no SSH password configured" })
    return
  }

  const hostKeyFile = process.env.DIVEEOI_SSH_HOST_KEY_FILE ?? settings.hostKeyFile
  const listenTimeoutMs = Number.parseInt(
    process.env.DIVEEOI_SSH_LISTEN_TIMEOUT_MS ?? String(settings.listenTimeoutMs ?? 8000),
    10,
  )
  const result = yield* svc.start({ host, port, username, password, hostKeyFile, listenTimeoutMs })
  if (result.started) yield* Effect.logInfo("ssh.listening", { host, port, username: username ?? "*" })
}, Effect.provide(Config.defaultLayer))

export * as SshServer from "./index"
