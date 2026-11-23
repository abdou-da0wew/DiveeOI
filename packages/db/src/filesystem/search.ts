export * as FileSystemSearch from "./search"

import path from "path"
import { Context, Effect, Fiber, Layer, Scope } from "effect"
import { Fff } from "./fff.bun"
import fuzzysort from "fuzzysort"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"

export interface Interface {
  readonly find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>
  readonly glob: (input: FileSystem.GlobInput) => Effect.Effect<readonly FileSystem.Entry[]>
  readonly grep: (input: FileSystem.GrepInput) => Effect.Effect<readonly FileSystem.Match[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem/Search") {}

export const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const scope = yield* Scope.Scope
    const state = {
      files: [] as string[],
      directories: [] as string[],
      all: [] as string[],
    }
    const directories = new Set<string>()

    // Keep the fallback index bounded and update directory state incrementally.
    // Rebuilding Array.from(directories) for every file made large workspaces
    // perform quadratic copying while ripgrep was still scanning the HDD.
    // Keep the fallback index idle until the file picker asks for it.
    // Scanning during per-workspace layer construction multiplied one crawl
    // into hundreds of concurrent ripgrep processes.
    // The first find() caller must WAIT for the crawl to finish: forking
    // fire-and-forget raced every cold query against the ripgrep scan and
    // served an empty index (findFile returned [] — httpapi-file
    // "serves search endpoints" failed on any machine slower than the VDS).
    const maxIndexedFiles = 40_000
    let indexStarted = false
    const startIndex = Effect.suspend(() => {
      if (indexStarted) return Effect.void
      indexStarted = true
      return ripgrep
        .find({
          cwd: location.directory,
          pattern: "*",
          limit: maxIndexedFiles,
          onEntry: (entry) =>
            Effect.sync(() => {
              const relative = entry.path.replaceAll("\\", "/")
              state.files.push(relative)
              state.all.push(relative)

              let end = relative.indexOf("/")
              while (end !== -1) {
                const directory = relative.slice(0, end + 1)
                if (!directories.has(directory)) {
                  directories.add(directory)
                  state.directories.push(directory)
                  state.all.push(directory)
                }
                end = relative.indexOf("/", end + 1)
              }
            }),
        })
        .pipe(
          // Fork keeps the crawl attached to the layer scope (cancelled on
          // teardown); joining it keeps the first find() caller correct.
          Effect.orDie,
          Effect.asVoid,
          Effect.forkIn(scope),
          Effect.flatMap((fiber) => Effect.asVoid(Fiber.join(fiber))),
        )
    })
    return Service.of({
      glob: (input) =>
        Effect.gen(function* () {
          const target = path.resolve(location.directory, input.path ?? ".")
          const info = yield* fs.stat(target).pipe(Effect.orDie)
          const cwd = info.type === "File" ? path.dirname(target) : target
          return yield* ripgrep
            .glob({
              cwd,
              pattern: input.pattern,
              limit: input.limit ?? Number.MAX_SAFE_INTEGER,
            })
            .pipe(
              Effect.map((result) =>
                result.map(
                  (entry) =>
                    new FileSystem.Entry({
                      ...entry,
                      path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, entry.path))),
                    }),
                ),
              ),
              Effect.orDie,
            )
        }),
      grep: (input) =>
        Effect.gen(function* () {
          const target = path.resolve(location.directory, input.path ?? ".")
          const info = yield* fs.stat(target).pipe(Effect.orDie)
          const cwd = info.type === "File" ? path.dirname(target) : target
          return yield* ripgrep
            .grep({
              cwd,
              pattern: input.pattern,
              file: info.type === "File" ? path.basename(target) : undefined,
              include: input.include,
              limit: input.limit ?? Number.MAX_SAFE_INTEGER,
            })
            .pipe(
              Effect.map((result) =>
                result.map(
                  (match) =>
                    new FileSystem.Match({
                      ...match,
                      entry: new FileSystem.Entry({
                        ...match.entry,
                        path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, match.entry.path))),
                      }),
                    }),
                ),
              ),
              Effect.orDie,
            )
        }),
      find: (input) =>
        Effect.gen(function* () {
          yield* startIndex
          const items =
            input.type === "file"
              ? state.files
              : input.type === "directory"
                ? state.directories
                : state.all
          return fuzzysort.go(input.query, items, { limit: input.limit ?? 50 }).map((item) => {
            const relative = item.target
            const type = relative.endsWith("/") ? ("directory" as const) : ("file" as const)
            const clean = type === "directory" ? relative.slice(0, -1) : relative
            const absolute = path.resolve(location.directory, clean)
            return new FileSystem.Entry({
              path: RelativePath.make(relative),
              type,
              mime: type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
            })
          })
        }),
    })
  }),
)

export const fffLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const result = yield* Effect.try({
      try: () =>
        Fff.create({
          basePath: location.directory,
          aiMode: true,
          // Keep indexing scoped to the active workspace. Scanning / and the
          // entire home directory duplicates work, churns HDD metadata caches,
          // and can retain several GiB in the native content/mmap indexes.
          enableFsRootScanning: false,
          enableHomeDirScanning: false,
          // Start serving without warming every file into an mmap/content cache.
          // Filename search remains indexed; grep can read matching files on demand.
          disableMmapCache: true,
          disableContentIndexing: true,
        }),
      catch: (cause) => `FFF.create threw: ${cause}`,
    })
    if (!result.ok) return yield* Effect.fail(`Failed to init file picker: ${result.error}`)
    yield* Effect.addFinalizer(() => Effect.sync(() => result.value.destroy()).pipe(Effect.ignore))
    return Service.of({
      glob: (input) =>
        Effect.sync(() => {
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          const found = result.value.glob(prefix ? `${prefix}/${input.pattern}` : input.pattern, {
            pageIndex: 0,
            pageSize: input.limit,
          })
          if (!found.ok) throw found.error
          return found.value.items.map((item) => {
            const absolute = path.resolve(location.directory, item.relativePath)
            return new FileSystem.Entry({
              path: RelativePath.make(item.relativePath.replaceAll("\\", "/")),
              type: "file",
              mime: FSUtil.mimeType(absolute),
            })
          })
        }),
      grep: (input) =>
        Effect.sync(() => {
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          const found = result.value.grep(
            [prefix ? `${prefix}/**` : undefined, input.include, input.pattern]
              .filter((value) => value !== undefined)
              .join(" "),
            { mode: "regex", pageSize: input.limit, timeBudgetMs: 1_500 },
          )
          if (!found.ok) throw found.error
          return found.value.items.map((match) => {
            const bytes = Buffer.from(match.lineContent)
            return new FileSystem.Match({
              entry: new FileSystem.Entry({
                path: RelativePath.make(match.relativePath.replaceAll("\\", "/")),
                type: "file",
                mime: FSUtil.mimeType(match.relativePath),
              }),
              line: match.lineNumber,
              offset: match.byteOffset,
              text: match.lineContent.length > 2_000 ? match.lineContent.slice(0, 2_000) + "..." : match.lineContent,
              submatches: match.matchRanges.map(([start, end]) => ({
                text: bytes.subarray(start, end).toString("utf8"),
                start,
                end,
              })),
            })
          })
        }),
      find: (input) =>
        Effect.sync(() => {
          const options = { pageIndex: 0, pageSize: input.limit ?? 50 }
          const items = (() => {
            if (input.type === "file") {
              const found = result.value.fileSearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "file" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            if (input.type === "directory") {
              const found = result.value.directorySearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "directory" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            const found = result.value.mixedSearch(input.query.trim(), options)
            if (!found.ok) throw found.error
            return found.value.items.map((item, index) => ({
              path: item.item.relativePath,
              type: item.type,
              score: found.value.scores[index]?.total ?? 0,
            }))
          })()
          return items
            .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
            .map((item) => {
              const relative = item.path.replaceAll("\\", "/").replace(/\/$/, "")
              const absolute = path.resolve(location.directory, relative)
              return new FileSystem.Entry({
                path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                type: item.type,
                mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
              })
            })
        }),
    })
  }),
)

// FFF starts a native background index while the location layer is built.
// Keep workspace startup idle and use the lazy ripgrep index for picker search.
export const defaultLayer = ripgrepLayer
