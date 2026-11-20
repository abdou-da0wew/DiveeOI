import { Effect } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"

export function withLocalToolContext<A, E, R>(effect: Effect.Effect<A, E, R>, enabled = false) {
  if (!enabled) return effect

  return Effect.gen(function* () {
    const current = yield* InstanceState.context
    const directory = current.remote ? (current.localDirectory ?? process.cwd()) : current.directory
    const local = {
      ...current,
      directory,
      worktree: directory,
      remote: undefined,
      stateKey: directory,
    }
    return yield* effect.pipe(Effect.provideService(InstanceRef, local))
  })
}

export * from "./remote-local-context"
