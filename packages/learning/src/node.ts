// packages/learning/src/node.ts
//
// LayerNode entry point for the Targeted Learning feature.
//
// This module is intentionally free of server-only imports. The feature
// flag check happens in `packages/server/src/app-services.ts` (matching
// the existing pattern at line 84 for the anchor nodes), which picks
// either `node` (real layer) or `disabledNode` (always-unavailable
// stub) based on `Features.flags.learning`.

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Global } from "@diveeoi/db/global"
import { layer as RealLayer, disabledLayer } from "./service"

/** The real BooksStore + manifest + setup state machine. */
export const node = LayerNode.make(RealLayer, [Global.node])

/** Always-unavailable stub. Used when the `learning` feature flag is off. */
export const disabledNode = LayerNode.make(disabledLayer, [])

export { TargetedLearning } from "./service"
export type { TargetedLearningInterface } from "./service"
export { BooksStore, BooksUnavailableError } from "./store"
export * as Settings from "./settings"
export * as Manifest from "./manifest"
export * as Probe from "./probe"
export * as Download from "./download"
export * as Setup from "./setup/state-machine"
export * as SelfTest from "./self-test"
export type { BooksStoreInterface } from "./store"
