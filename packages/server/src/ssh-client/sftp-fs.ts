import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { minimatch } from "minimatch"
import { FSUtil } from "@diveeoi/db/fs-util"
import type { Glob } from "@diveeoi/db/util/glob"
import type { SftpSession, SftpStat, RemoteConfig } from "./types"
import { RemoteSession } from "./index"
import { createSftpDiscovery } from "./sftp-discovery"
import { ensureRemoteDirectory } from "./sftp-paths"

export const RemoteConfigTag = Context.Service<RemoteConfigTag, RemoteConfig>()("@diveeoi/RemoteConfig")
export interface RemoteConfigTag extends RemoteConfig {}

export function makeSftpFs(sftp: SftpSession, platform: NodeJS.Platform, workingDirectory: string): FSUtil.Interface {
  const isWindows = platform === "win32"
  const discovery = createSftpDiscovery(sftp, workingDirectory)
  const readFile = (filePath: string) => sftp.readFile(filePath).pipe(Effect.map((buffer) => new Uint8Array(buffer)))
  const readFileString = (filePath: string) =>
    sftp.readFile(filePath).pipe(Effect.map((buffer) => new TextDecoder().decode(buffer)))
  const writeFile = (filePath: string, data: Uint8Array | string) => sftp.writeFile(filePath, data)
  const writeFileString = (filePath: string, data: string) => sftp.writeFile(filePath, data)

  const stat = (filePath: string) =>
    sftp.stat(filePath).pipe(
      Effect.map((value: SftpStat) => ({
        type: value.isDirectory ? ("Directory" as const) : ("File" as const),
        size: BigInt(value.size),
        mtime: new Date(value.mtime * 1000),
        atime: new Date(value.atime * 1000),
        mode: value.mode,
      })),
    )

  const exists = (filePath: string) =>
    sftp.stat(filePath).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    )
  const makeDirectory = (directory: string) => ensureRemoteDirectory(sftp, directory, workingDirectory)

  const readDirectory = (directory: string) =>
    sftp.listDir(directory).pipe(
      Effect.map((entries) =>
        entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory
            ? ("Directory" as const)
            : entry.isSymbolicLink
              ? ("SymbolicLink" as const)
              : ("File" as const),
        })),
      ),
    )

  const remove = (filePath: string) =>
    sftp
      .stat(filePath)
      .pipe(Effect.flatMap((info) => (info.isDirectory ? sftp.removeDirectory(filePath) : sftp.remove(filePath))))
  const rename = (oldPath: string, newPath: string) => sftp.rename(oldPath, newPath)
  const isDir = (filePath: string) =>
    sftp.stat(filePath).pipe(
      Effect.map((value) => value.isDirectory),
      Effect.catch(() => Effect.succeed(false)),
    )
  const isFile = (filePath: string) =>
    sftp.stat(filePath).pipe(
      Effect.map((value) => value.isFile),
      Effect.catch(() => Effect.succeed(false)),
    )
  const readFileStringSafe = (filePath: string) =>
    readFileString(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const readJson = (filePath: string) =>
    readFileString(filePath).pipe(
      Effect.flatMap((content) =>
        Effect.try({
          try: () => JSON.parse(content),
          catch: (cause) => new Error(`Unable to parse remote JSON file: ${String(cause)}`),
        }),
      ),
    )
  const writeJson = (filePath: string, data: unknown, mode?: number) =>
    writeFileString(filePath, JSON.stringify(data, null, 2)).pipe(
      Effect.flatMap(() => (mode ? sftp.chmod(filePath, mode) : Effect.void)),
    )
  const ensureDir = (directory: string) => ensureRemoteDirectory(sftp, directory, workingDirectory)
  const writeWithDirs = (filePath: string, content: string | Uint8Array, mode?: number) =>
    Effect.gen(function* () {
      const parent = isWindows
        ? filePath.slice(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))) || "."
        : filePath.slice(0, filePath.lastIndexOf("/")) || "."
      yield* ensureRemoteDirectory(sftp, parent, workingDirectory)
      yield* sftp.writeFile(filePath, content)
      if (mode) yield* sftp.chmod(filePath, mode)
    })
  const readDirectoryEntries = (directory: string) =>
    sftp.listDir(directory).pipe(
      Effect.map((entries) =>
        entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory
            ? ("directory" as const)
            : entry.isSymbolicLink
              ? ("symlink" as const)
              : ("file" as const),
        })),
      ),
    )

  const notSupported = (method: string) =>
    Effect.fail(new Error(`SFTP: ${method} is not supported over SFTP; use the shell tool instead`))

  return {
    readFile,
    readFileString,
    writeFile,
    writeFileString,
    stat,
    exists,
    makeDirectory,
    readDir: readDirectory,
    remove,
    rename,
    isDir,
    isFile,
    existsSafe: exists,
    readFileStringSafe,
    readJson,
    writeJson,
    ensureDir,
    writeWithDirs,
    readDirectoryEntries,
    glob: (pattern: string, options?: Glob.Options) => discovery.glob(pattern, options),
    globMatch: (pattern: string, filePath: string) =>
      minimatch(filePath.replace(/\\/g, "/"), pattern.replace(/\\/g, "/"), { dot: true }),
    findUp: discovery.findUp,
    up: (options: { targets: string[]; start: string; stop?: string }) =>
      discovery.up(options.targets, options.start, options.stop),
    groupUp: (options: { targets: string[]; start: string; stop?: string }) =>
      discovery.groupUp(options.targets, options.start, options.stop),
    globUp: discovery.globUp,
    copyFile: (source: string, destination: string) =>
      Effect.gen(function* () {
        const parent = path.posix.dirname(destination)
        yield* ensureRemoteDirectory(sftp, parent, workingDirectory)
        const content = yield* sftp.readFile(source)
        yield* sftp.writeFile(destination, content)
      }),
    chmod: (filePath: string, mode: number) => sftp.chmod(filePath, mode),
    link: () => notSupported("link") as never,
    makeTempDirectory: () => notSupported("makeTempDirectory") as never,
    makeTempDirectoryScoped: () => notSupported("makeTempDirectoryScoped") as never,
    open: () => notSupported("open") as never,
    stream: () => notSupported("stream") as never,
  } as unknown as FSUtil.Interface
}

export const sftpFsLayer = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const config = yield* RemoteConfigTag
    const remoteSvc = yield* RemoteSession.Service
    const connection = yield* remoteSvc.acquire(config)
    const sftp = yield* connection.sftp()
    const platform = config.platform ?? "linux"
    return FSUtil.Service.of(makeSftpFs(sftp, platform, config.workingDirectory))
  }),
)
