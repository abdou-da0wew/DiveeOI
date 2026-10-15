// packages/server/src/ssh-client/index.ts
// Outbound SSH connection manager (draft-10 remote sessions).
//
// Manages a pool of ssh2 Client instances keyed by `${host}:${port}:${user}`.
// Reference-counted: the first acquire opens the connection; the last release
// closes it. Each connection exposes exec (one-shot command), execStream
// (line-by-line), and sftp (for the SFTP-backed FSUtil layer).
//
// The connection pool is per-process. On server restart, all connections are
// lost — the InstanceStore re-acquires on next session access.

import { Context, Effect, Layer, Ref, Scope, Stream } from "effect"
import { LayerNode } from "@diveeoi/db/effect/layer-node"

export interface RemoteConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly auth:
    | { kind: "password"; password: string }
    | { kind: "privateKey"; keyPath: string; passphrase?: string }
    | { kind: "agent"; socketPath?: string }
  readonly workingDirectory: string
  readonly platform?: NodeJS.Platform
  readonly keepaliveIntervalMs?: number
}

export interface ExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface SftpSession {
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, Error>
  readonly writeFile: (path: string, data: Uint8Array | string) => Effect.Effect<void, Error>
  readonly stat: (path: string) => Effect.Effect<SftpStat, Error>
  readonly listDir: (path: string) => Effect.Effect<ReadonlyArray<SftpEntry>, Error>
  readonly mkdir: (path: string) => Effect.Effect<void, Error>
  readonly remove: (path: string) => Effect.Effect<void, Error>
  readonly rename: (oldPath: string, newPath: string) => Effect.Effect<void, Error>
  readonly realpath: (path: string) => Effect.Effect<string, Error>
}

export interface SftpStat {
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly size: number
  readonly mtime: number
  readonly atime: number
  readonly mode: number
}

export interface SftpEntry {
  readonly name: string
  readonly longname: string
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
  readonly size: number
  readonly mtime: number
  readonly atime: number
}

export interface Connection {
  readonly config: RemoteConfig
  readonly exec: (
    command: string,
    options?: {
      cwd?: string
      env?: Record<string, string>
      stdin?: string | Uint8Array
      timeoutMs?: number
    },
  ) => Effect.Effect<ExecResult, Error>
  readonly execStream: (
    command: string,
    options?: {
      cwd?: string
      env?: Record<string, string>
      includeStderr?: boolean
    },
  ) => Stream.Stream<string, Error>
  readonly sftp: () => Effect.Effect<SftpSession, Error>
  readonly close: () => Effect.Effect<void, Error>
}

export interface Interface {
  readonly acquire: (config: RemoteConfig) => Effect.Effect<Connection, Error, Scope.Scope>
  readonly has: (config: RemoteConfig) => Effect.Effect<boolean>
  readonly probe: (
    config: RemoteConfig,
  ) => Effect.Effect<{ ok: true; platform: NodeJS.Platform } | { ok: false; reason: string }>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/RemoteSession") {}

const connectionKey = (c: RemoteConfig) => `${c.host}:${c.port}:${c.user}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Map of key → { connection, refCount }
    const pool = new Map<
      string,
      { connection: Connection; refCount: number }
    >()

    const acquire = (config: RemoteConfig) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const key = connectionKey(config)
          const existing = pool.get(key)
          if (existing) {
            existing.refCount++
            return existing.connection
          }
          const conn = yield* Effect.tryPromise({
            try: () => createConnection(config),
            catch: (err) => err as Error,
          })
          pool.set(key, { connection: conn, refCount: 1 })
          return conn
        }),
        (conn) =>
          Effect.sync(() => {
            const key = connectionKey(conn.config)
            const entry = pool.get(key)
            if (!entry) return
            entry.refCount--
            if (entry.refCount <= 0) {
              pool.delete(key)
              void Effect.runPromise(conn.close().pipe(Effect.catch(() => Effect.void)))
            }
          }),
      )

    const has = (config: RemoteConfig) =>
      Effect.sync(() => pool.has(connectionKey(config)))

    const probe = (config: RemoteConfig) =>
      Effect.gen(function* () {
        const conn = yield* Effect.tryPromise({
          try: () => createConnection(config),
          catch: (err) => err as Error,
        })
        const result = yield* conn
          .exec("uname -s && uname -m")
          .pipe(Effect.timeout("10 seconds"), Effect.catch(() => Effect.succeed(null)))
        yield* conn.close().pipe(Effect.catch(() => Effect.void))
        if (!result || result.exitCode !== 0) {
          return { ok: false as const, reason: "command failed" }
        }
        const platform: NodeJS.Platform = result.stdout.includes("Darwin") ? "darwin" : "linux"
        return { ok: true as const, platform }
      }).pipe(
        Effect.catch((err) => Effect.succeed({ ok: false as const, reason: String(err) })),
      ) as Effect.Effect<{ ok: true; platform: NodeJS.Platform } | { ok: false; reason: string }>

    return Service.of({ acquire, has, probe })
  }),
)

export const defaultLayer = layer
export const node = LayerNode.make(layer, [])

export * as RemoteSession from "./index"

// --- Connection implementation ---

async function createConnection(config: RemoteConfig): Promise<Connection> {
  const ssh2 = await import("ssh2")
  const Client = ssh2.Client
  const client = new Client()

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("SSH connect timeout")), 15000)
    client.once("ready", () => {
      clearTimeout(timeout)
      resolve()
    })
    client.once("error", (err: Error) => {
      clearTimeout(timeout)
      reject(err)
    })
    const connectOpts: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.user,
      keepaliveInterval: config.keepaliveIntervalMs ?? 30_000,
      readyTimeout: 15_000,
    }
    if (config.auth.kind === "password") {
      connectOpts.password = config.auth.password
    } else if (config.auth.kind === "privateKey") {
      const fs = require("node:fs") as typeof import("node:fs")
      connectOpts.privateKey = fs.readFileSync(config.auth.keyPath, "utf-8")
      if (config.auth.passphrase) connectOpts.passphrase = config.auth.passphrase
    } else if (config.auth.kind === "agent") {
      connectOpts.agent = config.auth.socketPath ?? process.env.SSH_AUTH_SOCK
    }
    client.connect(connectOpts as any)
  })

  const exec: Connection["exec"] = (command, options) =>
    Effect.callback<ExecResult, Error>((resume) => {
      const cwd = options?.cwd ?? config.workingDirectory
      const fullCommand = options?.env
        ? `cd ${JSON.stringify(cwd)} && ${Object.entries(options.env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join(" && ")} && ${command}`
        : `cd ${JSON.stringify(cwd)} && ${command}`

      client.exec(fullCommand, (err: Error | undefined, stream: any) => {
        if (err) {
          resume(Effect.fail(err))
          return
        }
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        let exitCode = -1

        if (options?.stdin) {
          stream.write(options.stdin)
          stream.end()
        }

        stream.on("data", (data: Buffer) => stdoutChunks.push(data))
        stream.stderr.on("data", (data: Buffer) => stderrChunks.push(data))
        stream.on("exit", (code: number) => {
          exitCode = code ?? -1
        })
        stream.on("close", () => {
          resume(
            Effect.succeed({
              exitCode,
              stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
              stderr: Buffer.concat(stderrChunks).toString("utf-8"),
            }),
          )
        })
      })
    }).pipe(
      options?.timeoutMs
        ? Effect.timeout(`${options.timeoutMs} millis` as any)
        : (e) => e,
    )

  const execStream: Connection["execStream"] = (command, options) =>
    Stream.fromAsyncIterable(
      (async function* () {
        const cwd = options?.cwd ?? config.workingDirectory
        const fullCommand = `cd ${JSON.stringify(cwd)} && ${command}`
        const stream = await new Promise<any>((resolve, reject) => {
          client.exec(fullCommand, (err: Error | undefined, stream: any) => {
            if (err) reject(err)
            else resolve(stream)
          })
        })
        const queue: string[] = []
        let done = false
        let resolveWait: (() => void) | null = null

        const flush = () => {
          while (queue.length > 0) {
            // items are pushed by the data handler below
          }
        }
        void flush

        const onData = (data: Buffer) => {
          const lines = data.toString("utf-8").split("\n").filter((l) => l.length > 0)
          for (const line of lines) queue.push(line)
          resolveWait?.()
          resolveWait = null
        }

        stream.on("data", onData)
        if (options?.includeStderr) {
          stream.stderr.on("data", onData)
        }
        stream.on("close", () => {
          done = true
          resolveWait?.()
          resolveWait = null
        })

        while (true) {
          while (queue.length > 0) {
            yield queue.shift()!
          }
          if (done) break
          await new Promise<void>((r) => {
            resolveWait = r
          })
        }
      })(),
      (err) => err as Error,
    )

  const sftp: Connection["sftp"] = () =>
    Effect.callback<SftpSession, Error>((resume) => {
      client.sftp((err: Error | undefined, sftp: any) => {
        if (err) {
          resume(Effect.fail(err))
          return
        }
        const session: SftpSession = {
          readFile: (path) =>
            Effect.callback<Uint8Array, Error>((resume) => {
              sftp.readFile(path, (err: Error | null, data: Buffer) => {
                if (err) resume(Effect.fail(err))
                else resume(Effect.succeed(new Uint8Array(data)))
              })
            }),
          writeFile: (path, data) =>
            Effect.callback<void, Error>((resume) => {
              const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data)
              sftp.writeFile(path, buf, (err: Error | null) => {
                if (err) resume(Effect.fail(err))
                else resume(Effect.void)
              })
            }),
          stat: (path) =>
            Effect.callback<SftpStat, Error>((resume) => {
              sftp.stat(path, (err: Error | null, stats: any) => {
                if (err) resume(Effect.fail(err))
                else
                  resume(
                    Effect.succeed({
                      isFile: stats.isFile(),
                      isDirectory: stats.isDirectory(),
                      size: stats.size,
                      mtime: stats.mtime,
                      atime: stats.atime,
                      mode: stats.mode,
                    }),
                  )
              })
            }),
          listDir: (path) =>
            Effect.callback<ReadonlyArray<SftpEntry>, Error>((resume) => {
              sftp.readdir(path, (err: Error | null, list: any[]) => {
                if (err) resume(Effect.fail(err))
                else
                  resume(
                    Effect.succeed(
                      list.map((e) => ({
                        name: e.filename,
                        longname: e.longname,
                        isFile: e.attrs.isFile(),
                        isDirectory: e.attrs.isDirectory(),
                        isSymbolicLink: e.attrs.isSymbolicLink(),
                        size: e.attrs.size,
                        mtime: e.attrs.mtime,
                        atime: e.attrs.atime,
                      })),
                    ),
                  )
              })
            }),
          mkdir: (path) =>
            Effect.callback<void, Error>((resume) => {
              sftp.mkdir(path, (err: Error | null) => {
                if (err) resume(Effect.fail(err))
                else resume(Effect.void)
              })
            }),
          remove: (path) =>
            Effect.callback<void, Error>((resume) => {
              sftp.unlink(path, (err: Error | null) => {
                if (err) resume(Effect.fail(err))
                else resume(Effect.void)
              })
            }),
          rename: (oldPath, newPath) =>
            Effect.callback<void, Error>((resume) => {
              sftp.rename(oldPath, newPath, (err: Error | null) => {
                if (err) resume(Effect.fail(err))
                else resume(Effect.void)
              })
            }),
          realpath: (path) =>
            Effect.callback<string, Error>((resume) => {
              sftp.realpath(path, (err: Error | null, absPath: string) => {
                if (err) resume(Effect.fail(err))
                else resume(Effect.succeed(absPath))
              })
            }),
        }
        resume(Effect.succeed(session))
      })
    })

  const close: Connection["close"] = () =>
    Effect.callback<void, Error>((resume) => {
      client.end()
      client.once("close", () => resume(Effect.void))
    })

  return { config, exec, execStream, sftp, close }
}

import { Option } from "effect"
