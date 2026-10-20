export * as Schema from "./schema"
export * as Config from "./config"
export * as Node from "./node"
export * as Indexer from "./indexer"
export * as Graph from "./graph"
export * as Extractor from "./extractor"
export * as Session from "./session"
export * as Recall from "./recall"
export * as Consolidation from "./consolidation"
export * as MemoryModule from "./memory"

// Service exports for server integration
export { MemoryService } from "./memory"
export { SessionService } from "./session"
export { ExtractorService } from "./extractor"
export { ExtractionModels } from "./extraction-models"
export type { ExtractionModel, ExtractionModelResolver } from "./extraction-models"
import type { ExtractionModelResolver } from "./extraction-models"
export { GraphService } from "./graph"
export { MemoryConfig, defaultMemoryConfig } from "./config"
export { MemoryError } from "./schema"
export type { MemoryMessage } from "./extractor"
export type { SessionID, MemoryNodeID } from "./schema"
export type { AbsolutePath } from "@diveeoi/db/schema"

// Layer compositions
import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { MemoryLive } from "./memory"
import { NodeLive } from "./node"
import { IndexerLive } from "./indexer"
import { GraphLive } from "./graph"
import { ExtractorLive } from "./extractor"
import { SessionLive } from "./session"
import { RecallLive } from "./recall"
import { ConsolidationLive } from "./consolidation"
import { MemoryConfig } from "./config"
import { ExtractionModels } from "./extraction-models"
import { Effect, Layer } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { ModelsDev } from "@diveeoi/db/models-dev"
import { ProviderUserAgent } from "@diveeoi/db/zen-user-agent"
import { LLMClient } from "@diveeoi/llm"
import { RequestExecutor } from "@diveeoi/llm/route"
import * as MemoryModule from "./memory"

// Dependency nodes
const memoryConfig = LayerNode.make(MemoryConfig.defaultLayer, [])
const database = LayerNode.make(Database.defaultLayer, [])
const requestExecutor = LayerNode.make(RequestExecutor.defaultLayer, [])
const llmClient = LayerNode.make(LLMClient.layer, [requestExecutor])

// Service nodes
const indexer = LayerNode.make(IndexerLive, [database, memoryConfig])
const nodeSvc = LayerNode.make(NodeLive, [indexer, memoryConfig])
const graph = LayerNode.make(GraphLive, [indexer, memoryConfig])
// Extraction models are a background role resolved by the host through the Provider service
// (draft-10 §0d). Standalone/test composition gets the no-op resolver: extraction is skipped
// rather than calling a hardcoded endpoint.
const modelsDev = ModelsDev.node
// The gateway User-Agent: the Zen gateway only serves its anonymous tier to the app.
const providerUserAgent = ProviderUserAgent.node
// Candidates are derived from the live catalog, so a retired model drops out on its own.
// The server replaces this node with a Provider-backed resolver that honours the user's
// credentials and `models.background.memory`.
const extractionModels = LayerNode.make(
  Layer.effect(
    ExtractionModels,
    Effect.map(
      Effect.all([Effect.service(ModelsDev.Service), Effect.service(ProviderUserAgent.Service)]),
      ([catalog, userAgent]) => ExtractionModels.from(catalog, userAgent.resolve),
    ),
  ),
  [modelsDev, providerUserAgent],
)
const extractor = LayerNode.make(ExtractorLive, [llmClient, memoryConfig, indexer, extractionModels])
const memory = LayerNode.make(MemoryLive, [nodeSvc, indexer, graph, extractor, database, memoryConfig])
const session = LayerNode.make(SessionLive, [memory, memoryConfig])
const recall = LayerNode.make(RecallLive, [graph, memoryConfig])
const consolidation = LayerNode.make(ConsolidationLive, [memory, indexer])

// Main memory layer with all dependencies
export const MemoryLayer = LayerNode.buildLayer(
  LayerNode.group([memory, session, recall, consolidation, extractor, graph, memoryConfig])
)

// Convenience layer for just the core services (Node, Indexer, Graph)
export const CoreMemoryLayer = LayerNode.buildLayer(LayerNode.group([nodeSvc, indexer, graph]))

// LayerNode for server composition
export const MemoryNode = LayerNode.make(MemoryLayer, [
  database,
  llmClient,
  requestExecutor,
  memoryConfig,
  modelsDev,
  providerUserAgent,
  extractionModels,
])
/** Replacement seam: the server provides Provider-backed extraction models. */
export const withExtractionModels = (implementation: Layer.Layer<ExtractionModelResolver>) =>
  LayerNode.replace(extractionModels, implementation as unknown as Layer.Layer<ExtractionModels>)
export { extractionModels }

// Standard node export for server layer composition
export const node = MemoryNode

// Composite Memory export with node for server layer
export const Memory = {
  ...MemoryModule,
  node: MemoryNode,
  MemoryLayer,
  CoreMemoryLayer,
  MemoryNode,
  TestMemoryLayer: MemoryLayer,
  defaultLayer: MemoryLayer,
  withExtractionModels,
} as const

// Test layer alias
export const TestMemoryLayer = MemoryLayer