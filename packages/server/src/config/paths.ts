export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@diveeoi/db/flag/flag"
import { Global } from "@diveeoi/db/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@diveeoi/db/fs-util"

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

/**
 * Project config filenames ordered lowest-to-highest merge precedence.
 *
 * `Config.load` applies the list in order and later wins, so this encodes two independent
 * rankings that a single flat list has to satisfy at once:
 *
 *   - extension: `.jsonc` beats `.json` in the same directory (preserved from the original
 *     single-brand walk, where `up(...).toReversed()` produced the same ordering as a side
 *     effect of reversing the flattened list).
 *   - brand: `diveeoi.*` beats `opencode.*` at the same extension, so a fork-native file
 *     overrides an inherited upstream one instead of silently losing to it.
 *
 * Extension is the stronger of the two: `diveeoi.jsonc` > `opencode.jsonc` > `diveeoi.json` >
 * `opencode.json`. Directory proximity is applied separately by `groupUp`, which reverses whole
 * directories rather than this list.
 */
const projectTargets = ["opencode.json", "diveeoi.json", "opencode.jsonc", "diveeoi.jsonc"]

/**
 * Every project-level config file, across both brand names, ordered for merge: nearest directory
 * first and, within a directory, `projectTargets` order.
 *
 * Walking each brand separately would break this: `opencode.json` walked alone would land after
 * `diveeoi.json` from the same directory, and the two directories could not be interleaved.
 */
export const projectFiles = Effect.fn("ConfigPaths.projectConfigFiles")(function* (
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  const matches = yield* afs.groupUp({
    targets: projectTargets,
    start: directory,
    stop: worktree,
  })
  return matches.map((match) => path.join(match.path, match.target))
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".opencode"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".opencode"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

/**
 * Candidate config files in a directory, in preference order.
 *
 * `.jsonc` comes first so a freshly created file matches the extension the readers already
 * prefer (`files` above, `globalConfigFile` in config.ts) instead of writing a `.json` that
 * every one of them ranks below the `.jsonc` it did not find.
 */
export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.jsonc`), path.join(dir, `${name}.json`)]
}
