/**
 * Worker for `test/plugin/install-concurrency.test.ts`.
 *
 * Runs one plugin install per process so the cross-process file lock in `patchOne` is
 * actually contended. `holdMs` sleeps *inside* the critical section (between the read
 * and the write of the config file), which is what makes the lock load-bearing: without
 * it every process would finish before the next one started and the test would pass
 * even if serialization were broken.
 */
import { ConfigPaths } from "@/config/paths"
import { readPluginManifest, patchPluginConfig } from "../../src/plugin/install"
import { Filesystem } from "../../src/util/filesystem"

type Msg = {
  dir: string
  target: string
  mod: string
  holdMs?: number
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function input() {
  const raw = process.argv[2]
  if (!raw) throw new Error("Missing plugin worker input")
  return JSON.parse(raw) as Msg
}

async function main() {
  const msg = input()
  const manifest = await readPluginManifest(msg.target)
  if (!manifest.ok) throw new Error(`manifest read failed for ${msg.target}: ${manifest.code}`)

  const result = await patchPluginConfig(
    {
      spec: msg.mod,
      targets: manifest.targets,
      worktree: msg.dir,
      directory: msg.dir,
    },
    {
      readText: Filesystem.readText,
      write: async (file, text) => {
        // Hold the lock across the read/write window that patchOne performs.
        if (msg.holdMs && msg.holdMs > 0) await sleep(msg.holdMs)
        await Filesystem.write(file, text)
      },
      exists: Filesystem.exists,
      files: ConfigPaths.fileInDirectory,
    },
  )

  if (!result.ok) throw new Error(`patch failed: ${result.code}`)
}

await main().catch((err) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(text)
  process.exit(1)
})
