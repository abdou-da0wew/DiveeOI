// The upstream CLI wrapped every yargs command in an `effect-cmd.ts` shim that
// re-entered the legacy instance ALS (an AsyncLocalStorage-backed ambient
// context) after each awaited boundary. This fork's CLI (src/cli/index.ts) is
// hand-rolled and has no ALS at all, so the original test — which read
// src/cli/effect-cmd.ts — failed on a missing file rather than on a real
// regression.
//
// The invariant is still worth guarding, so it is asserted the only way that
// can actually fail: every TypeScript file under src/cli/ must be free of the
// legacy ambient-instance restore. A future CLI command that reintroduces it
// reintroduces the bug.
import { afterEach, expect } from "bun:test"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { InstanceRef } from "../../src/effect/instance-ref"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(FSUtil.defaultLayer)

afterEach(async () => {
  await disposeAllInstances()
})

it.live("no CLI source restores the legacy instance ALS", () =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const dir = fileURLToPath(new URL("../../src/cli", import.meta.url))
    const entries = yield* fs.readDirectoryEntries(dir)
    const sources = (
      yield* Effect.forEach(entries, (entry) =>
        entry.type !== "file" || !entry.name.endsWith(".ts")
          ? Effect.succeed(null)
          : fs.readFileStringSafe(`${dir}/${entry.name}`),
      )
    ).filter((text) => text !== null)

    // Guard against the sweep silently reading nothing — an empty file list
    // would make the loop below vacuously pass.
    expect(sources.length).toBe(entries.filter((e) => e.type === "file" && e.name.endsWith(".ts")).length)
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).not.toContain("restore(ctx")
    }
  }),
)

it.instance(
  "InstanceRef remains the handler context across Effect promise awaits",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const ctx = yield* InstanceRef
      if (!ctx) throw new Error("InstanceRef not provided")

      const directory = yield* Effect.promise(async () => {
        await Promise.resolve()
        return ctx.directory
      })

      expect(directory).toBe(test.directory)
    }),
  { git: true },
)
