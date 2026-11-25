/**
 * Server-safe export surface: validated, bounded entry points for the two MP4
 * pipelines (standard SVG/ImageMagick and native Rust/Cairo) plus the
 * bounded-frame preview API. The canonical AI tools and the server routes
 * consume this module; nothing here reads files unless the caller supplies a
 * project root, and every path stays inside that root.
 */
export { renderStandardVideo } from "./render/standard"
export { renderNativeVideo } from "./render/native-video"
export { renderPreviewFrames, PREVIEW_BUDGETS, type PreviewOptions, type PreviewResult, type PreviewFrame } from "./preview"
export { RENDER_PROFILES } from "./model/validate"
export type { RenderOptions, RenderProfile, RenderResult } from "./model/types"
