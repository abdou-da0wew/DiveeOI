import { Context, Layer, Schema } from "effect"
import { AbsolutePath } from "@diveeoi/db/schema"

// Recall configuration
export class RecallConfig extends Schema.Class<RecallConfig>("RecallConfig")({
  maxDepth: Schema.Int,
  maxNodes: Schema.Int,
  minConfidence: Schema.Number,
  typeWeights: Schema.Record(Schema.String, Schema.Number),
  depthPenaltyLambda: Schema.Number
}) {}

// Session configuration
export class SessionConfig extends Schema.Class<SessionConfig>("SessionConfig")({
  autoLoadDepth: Schema.Int,
  autoLoadMaxNodes: Schema.Int,
  extractOnEnd: Schema.Boolean
}) {}

// Consolidation configuration
export class ConsolidationConfig extends Schema.Class<ConsolidationConfig>("ConsolidationConfig")({
  enabled: Schema.Boolean,
  triggerTokens: Schema.Int,
  batchSize: Schema.Int
}) {}

// Feature toggles — all default to true for smooth upgrade
export class MemoryFeatures extends Schema.Class<MemoryFeatures>("MemoryFeatures")({
  multiProject: Schema.Boolean.pipe(Schema.withDefault(true)),      // Load memories from all projects
  autoDetectProjects: Schema.Boolean.pipe(Schema.withDefault(true)), // Scan for .divee/memory/ dirs
  orphanDetection: Schema.Boolean.pipe(Schema.withDefault(true)),   // Mark missing files
  projectBoundaries: Schema.Boolean.pipe(Schema.withDefault(true)), // Filter recall by project
  nonBlockingInit: Schema.Boolean.pipe(Schema.withDefault(true)),   // Background indexer init
  notifications: Schema.Boolean.pipe(Schema.withDefault(true)),     // Indexer ready events
  legacyOpencodePaths: Schema.Boolean.pipe(Schema.withDefault(true)), // Read .opencode/memory/ (legacy)
}) {}

// Memory config shape (encodable/decodable)
export class MemoryConfigShape extends Schema.Class<MemoryConfigShape>("MemoryConfig")({
  memoryDir: AbsolutePath,
  recall: RecallConfig,
  session: SessionConfig,
  consolidation: ConsolidationConfig,
  features: MemoryFeatures
}) {}

// Main memory configuration service
export class MemoryConfig extends Context.Service<MemoryConfig, MemoryConfigShape>()("@diveeoi/memory/MemoryConfig") {
  static make(input: Schema.Schema.Type<typeof MemoryConfigShape>): MemoryConfigShape {
    return MemoryConfigShape.make(input)
  }

  static get defaultLayer(): Layer.Layer<MemoryConfig> {
    return Layer.succeed(MemoryConfig, defaultMemoryConfig)
  }
}

// Default config instance
export const defaultMemoryConfig = MemoryConfig.make({
  memoryDir: ".divee/memory" as AbsolutePath,
  recall: RecallConfig.make({
    maxDepth: 2,
    maxNodes: 20,
    minConfidence: 0.3,
    typeWeights: {
      decision: 1.0,
      pattern: 0.9,
      error: 0.8,
      entity: 0.7,
      preference: 0.6,
      fact: 0.5,
      constraint: 0.5,
      session: 0.4
    },
    depthPenaltyLambda: 0.15
  }),
  session: SessionConfig.make({
    autoLoadDepth: 2,
    autoLoadMaxNodes: 15,
    extractOnEnd: true
  }),
  consolidation: ConsolidationConfig.make({
    enabled: true,
    triggerTokens: 10000,
    batchSize: 50
  }),
  features: MemoryFeatures.make({
    multiProject: true,
    autoDetectProjects: true,
    orphanDetection: true,
    projectBoundaries: true,
    nonBlockingInit: true,
    notifications: true,
    legacyOpencodePaths: true
  })
})
