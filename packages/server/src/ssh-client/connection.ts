import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { Effect, Stream } from "effect"
import type { ClientChannel, FileEntry, SFTPWrapper, Stats } from "ssh2"
import { sshKnownHostsFile } from "@/ssh/remote-paths"
import { SSHHostVerifier } from "./ssh-host-verifier"
import type { Connection, ExecResult, RemoteConfig, SftpEntry, SftpSession, SftpStat } from "./types"

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export async function createConnection(config: RemoteConfig): Promise<Connection> {
  const ssh2 = await import("ssh2")
  const client = new ssh2.Client()
  const knownHosts = await readFile(sshKnownHostsFile(), "utf8").catch(() => "")
  const verifyHostKey = SSHHostVerifier.createSSHHostKeyVerifier(config.host, config.port, knownHosts)

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("SSH connect timeout")), 15_000)
    const cleanup = () => clearTimeout(timeout)
    client.once("ready", () => {
      cleanup()
      resolve()
    })
    client.once("error", (error: Error) => {
      cleanup()
      reject(error)
    })

    const options: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.user,
      keepaliveInterval: config.keepaliveIntervalMs ?? 30_000,
      readyTimeout: 15_000,
      hostVerifier: verifyHostKey,
    }
    if (config.auth.kind === "password") {
      options.password = config.auth.password
    } else if (config.auth.kind === "privateKey") {
      options.privateKey = readFileSync(config.auth.keyPath, "utf8")
      if (config.auth.passphrase) options.passphrase = config.auth.passphrase
    } else {
      options.agent = config.auth.socketPath ?? process.env.SSH_AUTH_SOCK
    }
    client.connect(options as never)
  })

  const exec: Connection["exec"] = (command, options) =>
    Effect.callback<ExecResult, Error>((resume) => {
      const cwd = options?.cwd ?? config.workingDirectory
      const exports = Object.entries(options?.env ?? {})
        .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string")
        .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
      const fullCommand = [`cd -- ${shellQuote(cwd)}`, ...exports, command].join(" && ")

      client.exec(fullCommand, (error: Error | undefined, stream: ClientChannel) => {
        if (error) {
          resume(Effect.fail(error))
          return
        }

        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let exitCode = -1
        if (options?.stdin) {
          stream.write(options.stdin)
          stream.end()
        }
        stream.on("data", (data: Buffer) => stdout.push(data))
        stream.stderr.on("data", (data: Buffer) => stderr.push(data))
        stream.on("exit", (code: number | null) => {
          exitCode = code ?? -1
        })
        stream.on("error", (streamError: Error) => resume(Effect.fail(streamError)))
        stream.on("close", () =>
          resume(
            Effect.succeed({
              exitCode,
              stdout: Buffer.concat(stdout).toString("utf8"),
              stderr: Buffer.concat(stderr).toString("utf8"),
            }),
          ),
        )
      })
    }).pipe(options?.timeoutMs ? Effect.timeout(`${options.timeoutMs} millis` as never) : (effect) => effect)

  const execStream: Connection["execStream"] = (command, options) =>
    Stream.fromAsyncIterable(
      (async function* () {
        const cwd = options?.cwd ?? config.workingDirectory
        const fullCommand = `cd -- ${shellQuote(cwd)} && ${command}`
        const stream = await new Promise<ClientChannel>((resolve, reject) => {
          client.exec(fullCommand, (error: Error | undefined, channel: ClientChannel) => {
            if (error) reject(error)
            else resolve(channel)
          })
        })

        const queue: string[] = []
        let pending = ""
        let done = false
        let failure: Error | undefined
        let wake: (() => void) | undefined
        const signal = () => {
          wake?.()
          wake = undefined
        }
        const onData = (data: Buffer) => {
          const text = pending + data.toString("utf8")
          const lines = text.split("\n")
          pending = lines.pop() ?? ""
          queue.push(...lines.map((line) => line.replace(/\r$/, "")))
          signal()
        }

        stream.on("data", onData)
        if (options?.includeStderr) stream.stderr.on("data", onData)
        stream.on("error", (error: Error) => {
          failure = error
          done = true
          signal()
        })
        stream.on("close", () => {
          if (pending) queue.push(pending)
          done = true
          signal()
        })

        try {
          while (queue.length || !done) {
            while (queue.length) {
              const line = queue.shift()
              if (line !== undefined) yield line
            }
            if (failure) throw failure
            if (!done) await new Promise<void>((resolve) => (wake = resolve))
          }
        } finally {
          stream.off("data", onData)
          stream.close?.()
        }
      })(),
      (error) => error as Error,
    )

  const sftp: Connection["sftp"] = () =>
    Effect.callback<SftpSession, Error>((resume) => {
      client.sftp((error: Error | undefined, channel: SFTPWrapper) => {
        if (error) {
          resume(Effect.fail(error))
          return
        }

        const session: SftpSession = {
          readFile: (filePath) =>
            Effect.callback<Uint8Array, Error>((done) => {
              channel.readFile(filePath, (cause: Error | undefined, data: Buffer) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.succeed(new Uint8Array(data)))
              })
            }),
          writeFile: (filePath, data) =>
            Effect.callback<void, Error>((done) => {
              channel.writeFile(filePath, Buffer.from(data), (cause: Error | null | undefined) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.void)
              })
            }),
          stat: (filePath) =>
            Effect.callback<SftpStat, Error>((done) => {
              channel.stat(filePath, (cause: Error | undefined, value: Stats) => {
                if (cause) done(Effect.fail(cause))
                else {
                  done(
                    Effect.succeed({
                      isFile: value.isFile(),
                      isDirectory: value.isDirectory(),
                      size: value.size,
                      mtime: value.mtime,
                      atime: value.atime,
                      mode: value.mode,
                    }),
                  )
                }
              })
            }),
          listDir: (directory) =>
            Effect.callback<ReadonlyArray<SftpEntry>, Error>((done) => {
              channel.readdir(directory, (cause: Error | undefined, entries: FileEntry[]) => {
                if (cause) done(Effect.fail(cause))
                else {
                  done(
                    Effect.succeed(
                      entries.map((entry) => ({
                        name: entry.filename,
                        longname: entry.longname,
                        isFile: (entry.attrs.mode & 0o170000) === 0o100000,
                        isDirectory: (entry.attrs.mode & 0o170000) === 0o040000,
                        isSymbolicLink: (entry.attrs.mode & 0o170000) === 0o120000,
                        size: entry.attrs.size,
                        mtime: entry.attrs.mtime,
                        atime: entry.attrs.atime,
                      })),
                    ),
                  )
                }
              })
            }),
          mkdir: (directory) =>
            Effect.callback<void, Error>((done) => {
              channel.mkdir(directory, (cause: Error | null | undefined) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.void)
              })
            }),
          chmod: (filePath, mode) =>
            Effect.callback<void, Error>((done) => {
              channel.chmod(filePath, mode, (cause: Error | null | undefined) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.void)
              })
            }),
          remove: (filePath) =>
            Effect.callback<void, Error>((done) => {
              channel.unlink(filePath, (cause: Error | null | undefined) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.void)
              })
            }),
          removeDirectory: (directoryPath) =>
            Effect.callback<void, Error>((done) => {
              channel.rmdir(directoryPath, (cause: Error | null | undefined) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.void)
              })
            }),
          rename: (oldPath, newPath) =>
            Effect.callback<void, Error>((done) => {
              channel.rename(oldPath, newPath, (cause: Error | null | undefined) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.void)
              })
            }),
          realpath: (filePath) =>
            Effect.callback<string, Error>((done) => {
              channel.realpath(filePath, (cause: Error | undefined, value: string) => {
                if (cause) done(Effect.fail(cause))
                else done(Effect.succeed(value))
              })
            }),
        }
        resume(Effect.succeed(session))
      })
    })

  const close: Connection["close"] = () =>
    Effect.callback<void, Error>((resume) => {
      client.once("close", () => resume(Effect.void))
      client.end()
    })

  return { config, exec, execStream, sftp, close }
}

export * as SSHConnection from "./connection"
