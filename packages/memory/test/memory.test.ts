import { describe, it, expect } from "bun:test"
import { Effect, Option } from "effect"
import { MemoryLayer } from "../src/index"
import { MemoryService } from "../src/memory"
import { CreateNodeInput } from "../src/schema"

describe("Memory Service", () => {
  const runTest = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(effect.pipe(Effect.provide(MemoryLayer)))

  it("should create and retrieve a node", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        const input = CreateNodeInput.make({
          type: "fact",
          title: "Test Fact",
          content: "This is a test fact",
          tags: ["test", "fact"],
          sessionId: "ses_test123" as any
        })

        const node = yield* memory.createNode(input)
        expect(node.id).toBeDefined()
        expect(node.title).toBe("Test Fact")
        expect(node.content).toBe("This is a test fact")
        expect(node.tags).toEqual(["test", "fact"])

        const retrieved = yield* memory.getNode(node.id)
        expect(Option.isSome(retrieved)).toBe(true)
        expect(retrieved.value.title).toBe("Test Fact")

        return node
      })
    )
  })
})
