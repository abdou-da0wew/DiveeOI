import { describe, expect, test } from "bun:test"
import path from "path"

/**
 * Memory-integration verification list (TODO.md §5), disabled-feature arm:
 * "verify disabling the feature prevents layer/scheduler/route/tool work."
 *
 * Feature flags resolve once at module load (DIVEEOI_DISABLE_FEATURES), and
 * bun caches modules across test files in one process — so the actual checks
 * run in a child bun process (memory-disabled-child.ts) with the env var set
 * before any module load. This keeps the flag from leaking into other test
 * files of the suite.
 */

const childPath = path.join(import.meta.dir, "memory-disabled-child.ts")

describe("memory integration (disabled)", () => {
  test(
    "flag off → no scheduler fiber, no memory layers/routes/tools work",
    async () => {
      const proc = Bun.spawnSync(["bun", "run", childPath], {
        cwd: path.resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      })
      const out = proc.stdout.toString()
      const err = proc.stderr.toString()
      if (proc.exitCode !== 0) {
        console.error("disabled-child stdout:", out)
        console.error("disabled-child stderr:", err)
      }
      expect(proc.exitCode).toBe(0)
      expect(out).toContain("MEMORY-DISABLED-CHILD OK")
    },
    60_000,
  )
})
