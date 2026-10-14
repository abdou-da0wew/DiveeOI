import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { AdaptiveResourceService, defaultLayer as AdaptiveResourceDefaultLayer } from "@diveeoi/db/adaptive"
import { CrossSpawnSpawner } from "@diveeoi/db/cross-spawn-spawner"
import { Database } from "@diveeoi/db/database/database"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Ripgrep } from "@diveeoi/db/ripgrep"
import { MemoryLayer, Memory } from "@diveeoi/memory"
import { Effect, Layer } from "effect"
import { Anchor } from "@/anchor/anchor"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { Features } from "@/features"
import { SessionMemoryIntegration } from "@/session/memory"
import { Skill } from "@/skill"
import { Truncate } from "@/tool/truncate"

/**
 * Ambient services for hand-built test layer graphs.
 *
 * Most tests in this package assemble their own `Layer.mergeAll(...)` graph instead of using the
 * server's `LayerNode` graph, so any service that a *transitively* reachable layer requires at
 * build time has to be supplied explicitly. When one is missed the symptom is not a failing
 * assertion but `Service not found` during layer construction, which takes down every test in the
 * file at once and reads like a product bug.
 *
 * This is opt-in rather than folded into `testEffect` on purpose. A few tests - anything that
 * mocks `HttpClient` to assert on a request, and anything that supplies its own `Config` or
 * `RuntimeFlags` - must not have a real implementation injected underneath them, and a global base
 * silently wins those races. Importing this where it is actually needed keeps that explicit.
 *
 * Note what is deliberately absent: `Config`, `RuntimeFlags`, `Plugin`, `Session` and `MCP` all
 * carry state or connections a test may want to own, and `LSP`/`Skill` stand up HTTP clients, so
 * only add those to a graph that does not mock `HttpClient` itself.
 */
export const ambientLayer = Layer.mergeAll(
  AdaptiveResourceDefaultLayer,
  Ripgrep.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
  Format.defaultLayer,
  FSUtil.defaultLayer,
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  ...(Features.flags.memory ? [MemoryLayer, SessionMemoryIntegration.defaultLayer] : []),
  ...(Features.flags.anchor ? [Anchor.defaultLayer] : []),
)

/**
 * The same set plus the two services that open HTTP clients.
 *
 * Only for graphs that do not mock `HttpClient`: `LSP` and `Skill` each construct a real client,
 * and a test asserting on a mocked request will end up hitting the network instead.
 */
export const ambientWithClientsLayer = Layer.mergeAll(ambientLayer, Skill.defaultLayer, LSP.defaultLayer)

/**
 * Node form, for graphs assembled with `LayerNode.group`/`buildLayer`.
 *
 * `LayerNode.buildLayer` returns a layer with an opaque input, so `Layer.provideMerge` cannot
 * inject services into it after the fact - the missing service still fails to resolve at build
 * time. Merging these nodes into the group itself is the only shape that works for such graphs.
 */
export const ambientNodes = [
  LayerNode.make(AdaptiveResourceDefaultLayer, []),
  EventV2Bridge.node,
  Ripgrep.node,
  CrossSpawnSpawner.node,
  Truncate.node,
  Format.node,
  FSUtil.node,
  Database.node,
  ...(Features.flags.memory ? [Memory.node, SessionMemoryIntegration.node] : []),
  ...(Features.flags.anchor ? [Anchor.node] : []),
] as const

/** Same, plus the services that open HTTP clients. */
export const ambientWithClientsNodes = [...ambientNodes, Skill.node, LSP.node] as const

export * as TestAmbient from "./ambient"
