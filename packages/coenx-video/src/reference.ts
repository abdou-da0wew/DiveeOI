/**
 * Bounded, code-backed authoring reference sections for the canonical
 * `coenx_video_reference` tool. Sections describe the CURRENT implementation
 * state only; the capability matrix remains the machine-readable source of
 * truth for what is supported per backend.
 */
export const REFERENCE_TOPICS = ["overview", "composition-model", "cml", "masks", "gradients", "rendering-backends", "tools", "validation"] as const
export type ReferenceTopic = (typeof REFERENCE_TOPICS)[number]

const SECTIONS: Record<ReferenceTopic, string> = {
  "composition-model": `# Composition model (version 1)
One serializable VideoComposition is authoritative for every output backend.

- stage: { width 64-3840, height 64-2160, fps 1-60, background? }
- scenes[]: id, durationFrames (>=1), background?, nodes[], pathDefinitions?, clipPaths?, masks?, interactions?, camera3d?, lights3d?, physics?, physics3d?, transition?
- nodes: rect, ellipse, line, path, text, image, button, input, select, mesh3d. Every node: id, x, y, width, height, rotation?, scaleX?, scaleY?, opacity?, visible?, zIndex?, clipPathId?, maskId?, fontFamily?, fontSize?, fontWeight?, animations[].
- paints: solid color strings (#RGB, #RRGGBB, #RRGGBBAA) or gradient objects {type:"linear", from, to, stops[]} / {type:"radial", center, radius, stops[]} with 2-8 ordered stops (offset 0..1, #RRGGBB(AA) colors, optional opacity 0..1).
- reusable resources: pathDefinitions[] (id, width, height, commands[], fillRule?), clipPaths[] (id, pathId, fillRule?), masks[] (id, width, height, shapes[]).
- animations: property keyframes (frame, value, easing linear|ease-in|ease-out|ease-in-out|step); morph:<target> and *3d properties animate numeric values only.
- interactions: trigger click|submit|change|key|timer + optional when-expression + up to 24 actions (set/increment/goto/show/hide/feedback/playAudio/emit).
- audio[]: music|voiceover|sfx with startFrame, durationFrames, volume 0..2, fadeIn/Out.
- profile caps: low 1280x720@24, balanced 1920x1080@30, quality 3840x2160@60; 18k-36k frames, 2k-5k nodes, 1 active render.`,
  cml: `# CML authoring language (v1)

CML is a restricted declarative markup compiled to the shared composition model; it is not executed as JavaScript. Root element <coenx width height fps background? id? title? mode?>.

- <scene id? frames=N | duration="5s" background?>...</scene>
- visual elements: <rect> <ellipse> <line points="x,y; x,y"> <text> <image asset|src> <button> <input bind> <select bind><option/></select>. Geometry/positioning attributes: id, x, y, width, height, rotation, opacity, z-index, font-family, font-size, font-weight; styling: fill/background, stroke, stroke-width, border-radius, color, text-align, line-height.
- <animate property from to start end easing/> inside a node.
- <asset id src/> maps an asset id to a project-relative media path (no remote URLs).
- <audio id src kind start duration volume? loop? fadeIn? fadeOut?/>
- <citation bookId passageId title? quote? page?/> and mode="education" (requires objective + citations).
- A separate restricted script file compiles to a state/events AST: default export { state: {...}, events: [...] } with trigger actions only; eval/Function/arbitrary code is rejected.
- CML v1 does NOT expose path commands, reusable path/clip/mask definitions or gradient-paint objects; use JSON/TypeScript composition data for those features and validate with the tools.`,
  masks: `# Reusable alpha masks (WP2, v1)

- Definition: scene.masks[] = { id, width, height, shapes[] } with 1-16 flat shapes.
- Shape: { kind:"rect", x, y, width, height, radius?, fill } | { kind:"ellipse", x, y, width, height, fill } | { kind:"path", commands?|pathRef?, fill, fillRule?, opacity? }. Geometry uses top-left view-box units like path definitions; path shapes may reference scene pathDefinitions (reusing the WP1 resource graph).
- fill: any solid color (alpha from #RRGGBBAA or named/6-digit colors) or linear/radial gradient; only the alpha channel affects the mask. fill:"none" is rejected (it would mask everything away).
- Application: node.maskId references the resource. The mask view box scales onto the node box (same rule as clip paths), the node transform is inherited, node/transition opacity applies after masking, and content outside the node box is hidden. A node may combine clipPathId + maskId (clip cuts geometry first, then the mask multiplies alpha).
- Budgets: 32 masks/scene, 16 shapes/mask, 256 commands per shape path, view box <= 16384 per dimension and <= 4,194,304 pixels.
- Backends: all four (static SVG, interactive SVG, Canvas, native Cairo). SVG emits white-with-alpha shapes so luminance-mask renderers agree with alpha compositing. Canvas and Cairo composite inside a node-box-bounded offscreen surface.
- Luminance masks are NOT implemented (capability-gated off). mesh3d nodes cannot carry masks.`,
  gradients: `# Gradients and paints

- linear: { type:"linear", from:[x,y], to:[x,y], stops[] } with normalized coordinates (0.5 = node center, allowed range -2..2).
- radial: { type:"radial", center:[x,y], radius>0 <=4, stops[] } with radius relative to min(node width, height).
- stops: 2-8 entries, ordered offsets 0..1, #RRGGBB(AA) colors, optional opacity 0..1.
- Supported on all four renderers with identical stop semantics. Gradient transforms, conic gradients and repeat/reflect spread modes are NOT implemented (pad behavior only); the capability matrix reports this.
- Reusable paint resources are not yet part of the model; each node carries its own paint value.`,
  "rendering-backends": `# Rendering backends and selection

- static-svg: SVG frame composition -> packaged ImageMagick raster -> FFmpeg H.264 MP4. Broad compatibility path. Supports shapes, text, images, buttons, inputs, selects, inline + reusable paths, clip paths, masks, gradients, CPU 3D projection, animation, transitions, audio.
- native-cairo: Rust/Cairo/Pango frame renderer -> FFmpeg MP4 (renderer: "native"). Same feature set minus select controls; opt-in per render.
- interactive-canvas / interactive-svg: browser playback with the interaction engine, DOM controls and audio; export as an interactive project.
- Backend rules: choose from the capability matrix (coenx_video_capabilities); never silently drop a feature; the output manifest records the backend used. One render at a time per process; renders are cancellable and frame-addressable.
- GPU 3D is planned, not available; current 3D is CPU software projection with deterministic physics.`,
  tools: `# Canonical AI tools

- coenx_video_capabilities: no input; machine-readable capability matrix (renderers, features, authoring gaps, 3D truth). Call before choosing backends or features.
- coenx_video_validate: { format:"cml"|"json", source, styles?, script? } -> structured diagnostics + summary. Compiles/validates without rendering; 2 MiB source bound; no file access.
- coenx_video_inspect: { format, source, styles?, script? } -> structural summary (scenes, node/resource ids, timing, assets, feature requirements). Read-only.
- coenx_video_preview: { format, source, frames (<=8 indices), maxDimension (128-1280), styles?, script? } -> PNG frames (base64 file parts) + backend metadata. Static-SVG backend; image assets must be inline data URLs or resolvable inside the caller-provided project root.
- coenx_video_export: { format, source, outputPath, renderer "auto"|"svg"|"native", profile "low"|"balanced"|"quality", overwrite?, styles?, script? } -> MP4 manifest. Requires write permission on the output path; refuses existing outputs unless overwrite; assets resolve inside the location root; cancellable; manifest records backend/bytes/frames.
- coenx_video_reference: { topic } -> the matching bounded reference section (this document).
- All tools use typed Effect Schema I/O and the canonical Tool.make registry; errors are structured diagnostics or ToolFailure with repair hints.`,
  validation: `# Validation workflow

1. Author the project (CML or JSON composition data).
2. Call coenx_video_validate (or coenx_video_inspect for a structural summary). Repair EVERY error diagnostic, then validate again until clean.
3. Diagnostics carry stable codes: source.too_large, source.unexpected_files, source.invalid_json, source.compile_failed, composition.invalid (message lists each violated rule).
4. Validation is static: it never touches project files, media, the network or JavaScript execution. Asset existence is checked at render/export time.
5. Profile caps apply at render time per profile; validation uses the quality profile as the ceiling.
6. For masks/clips/paths the validator enforces reference integrity, duplicate ids, fill rules, geometry bounds and the documented budgets before any backend runs.`,
  overview: `# Coenx Video overview

Coenx Video is DiveeOI's code-authored video engine: one validated serializable composition model rendered consistently to static MP4 (SVG/ImageMagick/FFmpeg or Rust/Cairo native), interactive browser playback (Canvas/SVG) and bounded AI-tool workflows.

Authoring surfaces: CML markup + restricted script (JSON-model subset) or structured JSON/TypeScript composition data (full model). AI access runs through the canonical coenx_video_* tools registered in the DiveeOI tool registry; capabilities are code-backed, never hand-maintained prose.

Recommended workflow: capabilities -> author -> validate -> (inspect) -> preview frames -> export MP4/interactive -> verify manifest. Skills in .agents/skills/coenx-video* cover language, rendering, motion, typography, accessibility, physics, sound and learning-specific guidance.`,
}

export function referenceSection(topic: ReferenceTopic): { topic: ReferenceTopic; title: string; body: string } {
  return { topic, title: topic, body: SECTIONS[topic] }
}

export function referenceTopics(): ReferenceTopic[] {
  return [...REFERENCE_TOPICS]
}
