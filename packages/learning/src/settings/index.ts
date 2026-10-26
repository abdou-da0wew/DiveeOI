// packages/learning/src/settings/index.ts
export * as Settings from "./index"
export {
  Info,
  CONFIG_KEY,
  Group,
  SettingAnnotations,
  annotations,
  type AppliesMode,
  DownloadSettings,
  EmbeddingSettings,
  ChunkingSettings,
  IndexingSettings,
  OcrSettings,
  RetrievalSettings,
  GateSettings,
  GroundingSettings,
  StudentMemorySettings,
  LanguageSettings,
  SummariesSettings,
} from "./schema"
export { DEFAULTS, withDefaults, PRESETS } from "./defaults"

// Convenience alias for callers that want a single obvious name.
import { Info as _Info } from "./schema"
export const TargetedLearningSchema = _Info
