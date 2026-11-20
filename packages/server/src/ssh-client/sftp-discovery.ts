import path from "node:path"
import { Effect } from "effect"
import { minimatch } from "minimatch"
import type { Glob } from "@diveeoi/db/util/glob"
import type { SftpSession } from "./types"

const posix = path.posix
const hasMagic = /[*?{}()[\]]/

export function createSftpDiscovery(sftp: SftpSession, workingDirectory: string) {
  const resolveStart = (start: string) =>
    posix.resolve(start.startsWith("/") ? start : posix.join(workingDirectory, start))

  const exists = (candidate: string) =>
    sftp.stat(candidate).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    )

  const parents = (start: string, stop?: string) => {
    const result: string[] = []
    let current = resolveStart(start)
    const boundary = stop ? resolveStart(stop) : undefined

    while (true) {
      result.push(current)
      if (current === boundary || posix.dirname(current) === current) break
      current = posix.dirname(current)
    }

    return result
  }

  const up = (targets: string[], start: string, stop?: string) =>
    Effect.gen(function* () {
      const result: string[] = []
      for (const directory of parents(start, stop)) {
        for (const target of targets) {
          const candidate = posix.join(directory, target)
          if (yield* exists(candidate)) result.push(candidate)
        }
      }
      return result
    })

  const glob = (pattern: string, options: Glob.Options = {}) =>
    Effect.gen(function* () {
      const normalizedPattern = pattern.replace(/\\/g, "/")
      const absolutePattern = normalizedPattern.startsWith("/")
      const base = absolutePattern ? "/" : resolveStart(options.cwd ?? workingDirectory)
      const segments = normalizedPattern.split("/")
      const staticSegments: string[] = []
      for (const segment of segments) {
        if (hasMagic.test(segment)) break
        if (segment) staticSegments.push(segment)
      }

      const hasPatternMagic = hasMagic.test(normalizedPattern)
      if (!hasPatternMagic) {
        const direct = absolutePattern ? posix.normalize(normalizedPattern) : posix.resolve(base, normalizedPattern)
        const info = yield* sftp.stat(direct).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!info || (!options.include && !info.isFile)) return []
        return [options.absolute || absolutePattern ? direct : posix.relative(base, direct)]
      }

      const staticPrefix = (absolutePattern ? "/" : "") + staticSegments.join("/")
      let root = staticPrefix ? posix.resolve(base, staticPrefix) : base
      let matchPattern = segments.slice(staticSegments.length).join("/") || "**/*"
      if (!staticSegments.length) matchPattern = normalizedPattern.replace(/^\/+/, "")

      const rootInfo = yield* sftp.stat(root).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (rootInfo && !rootInfo.isDirectory) {
        root = posix.dirname(root)
        matchPattern = posix.join(posix.basename(staticPrefix), matchPattern)
      } else if (!rootInfo) {
        return []
      }

      const matches: string[] = []
      const queue = [root]
      const visited = new Set<string>()
      let visitedEntries = 0

      while (queue.length) {
        const directory = queue.shift()
        if (!directory) continue
        const realDirectory = yield* sftp.realpath(directory).pipe(Effect.catch(() => Effect.succeed(directory)))
        if (visited.has(realDirectory)) continue
        visited.add(realDirectory)

        const entries = yield* sftp
          .listDir(directory)
          .pipe(Effect.catch((error) => (directory === root ? Effect.fail(error) : Effect.succeed([]))))

        for (const entry of entries) {
          if (entry.name === "." || entry.name === "..") continue
          visitedEntries++
          if (visitedEntries > 50_000) {
            return yield* Effect.fail(new Error("SFTP glob scan exceeded 50,000 entries. Narrow the pattern."))
          }

          const fullPath = posix.join(directory, entry.name)
          let isDirectory = entry.isDirectory
          if (entry.isSymbolicLink && options.symlink) {
            const info = yield* sftp.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            isDirectory = info?.isDirectory ?? false
          } else if (entry.isSymbolicLink) {
            continue
          }

          const relativePath = posix.relative(root, fullPath)
          const candidate = relativePath
          if (
            (!isDirectory || options.include === "all") &&
            minimatch(candidate, matchPattern, { dot: options.dot ?? false })
          ) {
            matches.push(options.absolute || absolutePattern ? fullPath : posix.relative(base, fullPath))
          }

          if (isDirectory) queue.push(fullPath)
        }
      }

      return matches.sort()
    })

  const findUp = (target: string, start: string, stop?: string) =>
    Effect.gen(function* () {
      const result: string[] = []
      for (const directory of parents(start, stop)) {
        const candidate = posix.join(directory, target)
        if (yield* exists(candidate)) result.push(candidate)
      }
      return result
    })

  const groupUp = (targets: string[], start: string, stop?: string) =>
    Effect.gen(function* () {
      const groups: { path: string; target: string }[][] = []
      for (const directory of parents(start, stop)) {
        const matches: { path: string; target: string }[] = []
        for (const target of targets) {
          if (yield* exists(posix.join(directory, target))) matches.push({ path: directory, target })
        }
        if (matches.length) groups.push(matches)
      }
      return groups.toReversed().flat()
    })

  const globUp = (pattern: string, start: string, stop?: string) =>
    Effect.gen(function* () {
      const matches: string[] = []
      for (const directory of parents(start, stop)) {
        const found = yield* glob(pattern, {
          cwd: directory,
          absolute: true,
          include: "file",
          dot: true,
        }).pipe(Effect.catch(() => Effect.succeed([] as string[])))
        matches.push(...found)
      }
      return matches
    })

  return { glob, findUp, up, groupUp, globUp }
}
