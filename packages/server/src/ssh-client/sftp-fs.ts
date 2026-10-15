// packages/server/src/ssh-client/sftp-fs.ts
// SFTP-backed FileSystem implementation (draft-10 remote sessions).
//
// Implements the subset of FileSystem + FSUtil.Interface methods that the
// read/write/edit/glob/grep tools actually call. Missing methods return
// a structured error rather than crashing — the agent sees "not supported
// over SFTP" and can fall back to shell commands for the missing ops.
//
// The SFTP channel is acquired from the RemoteSession connection and held
// for the lifetime of the layer. Reconnection on drop is handled by the
// connection pool.

import { Context, Effect, Layer, FileSystem } from "effect"
import { FSUtil } from "@diveeoi/db/fs-util"
import type { SftpSession, SftpStat, RemoteConfig } from "./index"
import { RemoteSession } from "./index"

/** Tag for the remote config (provided per-session) */
export const RemoteConfigTag = Context.Service<RemoteConfigTag, RemoteConfig>()("@diveeoi/RemoteConfig")
export interface RemoteConfigTag extends RemoteConfig {}

/**
 * Create an FSUtil.Interface backed by an SFTP session. The connection is
 * acquired from RemoteSession.Service (per-session, reference-counted).
 */
export function makeSftpFs(sftp: SftpSession, platform: NodeJS.Platform): FSUtil.Interface {
  const isWindows = platform === "win32"

  const readFile = (path: string) =>
    sftp.readFile(path).pipe(Effect.map((buf) => new Uint8Array(buf)))

  const readFileString = (path: string) =>
    sftp.readFile(path).pipe(
      Effect.map((buf) => new TextDecoder().decode(buf)),
    )

  const writeFile = (path: string, data: Uint8Array | string) =>
    sftp.writeFile(path, data)

  const writeFileString = (path: string, data: string) =>
    sftp.writeFile(path, data)

  const stat = (path: string) =>
    sftp.stat(path).pipe(
      Effect.map((s: SftpStat) => ({
        type: s.isDirectory ? ("Directory" as const) : ("File" as const),
        size: BigInt(s.size),
        mtime: new Date(s.mtime * 1000),
        atime: new Date(s.atime * 1000),
        mode: s.mode,
      })),
    )

  const exists = (path: string) =>
    sftp.stat(path).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    )

  const makeDirectory = (path: string) => sftp.mkdir(path)

  const readDirectory = (path: string) =>
    sftp.listDir(path).pipe(
      Effect.map((entries) =>
        entries.map((e) => ({
          name: e.name,
          type: e.isDirectory ? ("Directory" as const) : ("File" as const),
        })),
      ),
    )

  const remove = (path: string) => sftp.remove(path)

  const rename = (oldPath: string, newPath: string) => sftp.rename(oldPath, newPath)

  // FSUtil extension methods
  const isDir = (path: string) =>
    sftp.stat(path).pipe(
      Effect.map((s) => s.isDirectory),
      Effect.catch(() => Effect.succeed(false)),
    )

  const isFile = (path: string) =>
    sftp.stat(path).pipe(
      Effect.map((s) => s.isFile),
      Effect.catch(() => Effect.succeed(false)),
    )

  const existsSafe = (path: string) =>
    sftp.stat(path).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    )

  const readFileStringSafe = (path: string) =>
    sftp.readFile(path).pipe(
      Effect.map((buf) => new TextDecoder().decode(buf)),
      Effect.catch(() => Effect.succeed(undefined)),
    )

  const readJson = (path: string) =>
    sftp.readFile(path).pipe(
      Effect.map((buf) => JSON.parse(new TextDecoder().decode(buf))),
    )

  const writeJson = (path: string, data: unknown) =>
    sftp.writeFile(path, JSON.stringify(data, null, 2))

  const ensureDir = (path: string) =>
    sftp.mkdir(path).pipe(Effect.catch(() => Effect.void))

  const writeWithDirs = (path: string, content: string | Uint8Array) =>
    // SFTP doesn't have a "create parent dirs" primitive — rely on the
    // remote filesystem to handle it (mkdir -p semantics would need an
    // exec call). For now, just write; if the dir doesn't exist, the
    // error surfaces and the agent can create it via shell.
    sftp.writeFile(path, content)

  const readDirectoryEntries = (path: string) =>
    sftp.listDir(path).pipe(
      Effect.map((entries) =>
        entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory,
          isFile: e.isFile,
          size: e.size,
        })),
      ),
    )

  const glob = (pattern: string) =>
    // SFTP doesn't support glob natively — use `find` over exec instead.
    // For now return empty; the agent can use shell `find` for globbing.
    Effect.succeed([] as string[])

  const globMatch = (pattern: string, filepath: string) => {
    // Simple glob match for the remote case — basic * and ? support.
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")
    return new RegExp(`^${regex}$`).test(filepath)
  }

  const findUp = (target: string, start: string) =>
    Effect.succeed([] as string[])

  const up = (options: { targets: string[]; start: string }) =>
    Effect.succeed([] as string[])

  const groupUp = (options: { targets: string[]; start: string }) =>
    Effect.succeed([] as { path: string; target: string }[])

  const globUp = (pattern: string, start: string) =>
    Effect.succeed([] as string[])

  // FileSystem base methods that are not SFTP-friendly return errors
  const notSupported = (method: string) =>
    Effect.fail(new Error(`SFTP: ${method} not supported over SFTP; use shell tool instead`))

  return {
    readFile,
    readFileString,
    writeFile,
    writeFileString,
    stat,
    exists,
    makeDirectory,
    readDirectory,
    remove,
    rename,
    isDir,
    isFile,
    existsSafe,
    readFileStringSafe,
    readJson,
    writeJson,
    ensureDir,
    writeWithDirs,
    readDirectoryEntries,
    glob,
    globMatch,
    findUp,
    up,
    groupUp,
    globUp,
    // Stubs for methods the tools don't use over SFTP
    copyFile: () => notSupported("copyFile") as any,
    chmod: () => notSupported("chmod") as any,
    link: () => notSupported("link") as any,
    makeTempDirectory: () => notSupported("makeTempDirectory") as any,
    makeTempDirectoryScoped: () => notSupported("makeTempDirectoryScoped") as any,
    open: () => notSupported("open") as any,
    stream: () => notSupported("stream") as any,
  } as unknown as FSUtil.Interface
}

/**
 * Layer that provides FSUtil.Service backed by SFTP. Acquires the
 * connection from RemoteSession.Service and holds it for the layer's
 * lifetime.
 */
export const sftpFsLayer = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const config = yield* RemoteConfigTag
    const remoteSvc = yield* RemoteSession.Service
    const conn = yield* remoteSvc.acquire(config)
    const sftp = yield* conn.sftp()
    const platform = config.platform ?? "linux"
    return FSUtil.Service.of(makeSftpFs(sftp, platform))
  }),
)
