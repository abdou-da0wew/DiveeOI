/**
 * Child process for memory-disabled.test.ts.
 *
 * Runs in a fresh bun process with DIVEEOI_DISABLE_FEATURES=memory set BEFORE
 * any module load, so Features.flags resolves with memory disabled. The parent
 * suite process must never import feature-flagged modules with a poisoned env
 * (bun caches modules across test files in one process).
 */

process.env.DIVEEOI_DISABLE_FEATURES = "memory"

const { Features } = await import("../../src/features")
const { SessionMemoryIntegration } = await import("../../src/session/memory")
const { MemoryScheduler } = await import("../../src/session/memory-scheduler")
const { memoryExtractRoute } = await import("../../src/server/routes/instance/httpapi/handlers/memory")
const { readFileSync } = await import("fs")
const { Effect, Exit, Layer } = await import("effect")

const assert = (cond: unknown, message: string): void => {
  if (!cond) {
    console.error(`MEMORY-DISABLED-CHILD FAIL: ${message}`)
    process.exit(1)
  }
}

assert(Features.flags.memory === false, "Features.flags.memory must be false")

// Disabled layers build with zero requirement nodes — no database, no
// extractor, no scheduler fiber is ever constructed.
assert(MemoryScheduler.node !== undefined, "MemoryScheduler.node export present")
assert(memoryExtractRoute !== undefined, "memoryExtractRoute export present")

const registrySource = readFileSync(new URL("../../src/tool/registry.ts", import.meta.url), "utf8")
assert(registrySource.includes("!Features.flags.memory"), "registry gates memory tools on the feature flag")
assert(registrySource.includes('import("./memory")'), "memory tools are dynamically imported behind the flag")

const exit = await Effect.runPromise(
  Effect.gen(function* () {
    const scheduler = yield* MemoryScheduler.MemorySchedulerService
    yield* scheduler.start() // no-op: no fiber, no extraction pass
    yield* scheduler.stop()
    yield* scheduler.extractNow()
    yield* scheduler.extractNow("ses_anything")
    const nextRun = yield* scheduler.getNextRun()
    assert(nextRun === undefined, "disabled scheduler must never report a next run")

    const sessionMemory = yield* SessionMemoryIntegration.Service
    yield* sessionMemory.initializeSessionMemory("ses_anything", "title")
    yield* sessionMemory.extractSessionMemory("ses_anything", [{ role: "user", content: "hello" }])
    const context = yield* sessionMemory.loadSessionContext("ses_anything", "query")
    assert(context === "", "disabled context loading must return empty string")
    yield* sessionMemory.runConsolidationMaintenance()
    return "ok"
  }).pipe(
    Effect.provide(Layer.mergeAll(MemoryScheduler.defaultLayer, SessionMemoryIntegration.defaultLayer)),
    Effect.scoped,
    Effect.exit,
  ),
)

assert(Exit.isSuccess(exit), `disabled layer effects must all be no-ops (exit: ${Exit.isSuccess(exit)})`)

console.log("MEMORY-DISABLED-CHILD OK")
process.exit(0)
