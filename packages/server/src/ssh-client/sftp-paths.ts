import path from "node:path"
import { Effect } from "effect"
import type { SftpSession } from "./types"

const posix = path.posix

export function ensureRemoteDirectory(sftp: SftpSession, directory: string, workingDirectory: string) {
  return Effect.gen(function* () {
    const input = directory || "."
    const absolute = posix.normalize(input.startsWith("/") ? input : posix.join(workingDirectory, input))
    let current = "/"

    for (const segment of absolute.split("/").filter(Boolean)) {
      current = posix.join(current, segment)
      const info = yield* sftp.stat(current).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (info?.isDirectory) continue
      if (info) return yield* Effect.fail(new Error(`Cannot create directory because a file exists at ${current}`))

      yield* sftp.mkdir(current).pipe(
        Effect.catch((error) =>
          sftp.stat(current).pipe(
            Effect.flatMap((created) => (created.isDirectory ? Effect.void : Effect.fail(error))),
            Effect.catch(() => Effect.fail(error)),
          ),
        ),
      )
    }
  })
}
