import { Effect, Exit } from "effect"
import { _beginScope, _endScope, isEnabled } from "./core"

export const effect = <A, E, R>(
  key: string,
  program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  if (!isEnabled()) return program
  return Effect.acquireUseRelease(
    Effect.sync(() => _beginScope(key)),
    () => program,
    (begin, exit) => Effect.sync(() => _endScope(begin, Exit.isFailure(exit))),
  )
}
