/**
 * Bounded, code-backed authoring reference sections for the canonical
 * `coenx_video_reference` tool. Sections describe the CURRENT implementation
 * state only; the capability matrix remains the machine-readable source of
 * truth for what is supported per backend.
 */
export const REFERENCE_TOPICS = ["overview", "composition-model", "cml", "masks", "effects", "gradients", "rendering-backends", "tools", "validation"] as const
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
- visual elements: <rect> <ellipse> <line points="x,y; x,y"> <text> <image asset|src> <button> <input bind> <select bind><option/></select>. Geometry/positioning attributes: id, x, y, width, height, rotation, opacity, z-index, font-family, font-size, font-weight; styling: fill/background, stroke, stroke-width, border-radius, color, text-align, line-height; resource references: clip="clip-id", mask="mask-id", filter="blur(8) ...", path-ref on <path>, fill="url(#gradient-id)".
- <animate property from to start end easing/> inside a node.
- <defs> inside a scene compiles reusable resources: <path id d viewBox? fill-rule?>, <clip id path fill-rule?>, <mask id viewBox> with rect/ellipse/path shape children, and <gradient id type from/to|center/radius spread?> with <stop/> children (paint resources).
- The filter attribute accepts the bounded chain syntax: blur(r), drop-shadow(dx dy r color?), brightness(a), contrast(a), saturate(a), hue-rotate(deg); at most 4 functions per node.
- <asset id src/> maps an asset id to a project-relative media path (no remote URLs).
- <audio id src kind start duration volume? loop? fadeIn? fadeOut?/>
- <citation bookId passageId title? quote? page?/> and mode="education" (requires objective + citations).
- A separate restricted script file compiles to a state/events AST: default export { state: {...}, events: [...] } with trigger actions only; eval/Function/arbitrary code is rejected.
- CML v1 does NOT expose mesh3d authoring; use JSON/TypeScript composition data for mesh3d and validate with the tools. Every compiler error carries a (line, column) location plus a repair hint.`,
  effects: `# Filter effects (WP4, v1)

- Node field: effects[] = ordered chain of bounded effects applied to the node's rendered content BEFORE clipping, masking and opacity, in list order (the SVG rendering model). In CML: filter="blur(8) drop-shadow(2 3 4 #000000) brightness(1.2) contrast(1.1) saturate(0.8) hue-rotate(15)".
- Accepted effects: { type:"blur", radius 0..64 } | { type:"drop-shadow", dx/dy within +/-128, radius 0..32, color #RRGGBB(AA), default black } | { type:"color-adjust", brightness/contrast/saturate 0..4, hueRotate +/-360 }.
- Budgets: at most 4 effects per node; the padded temporary surface (node box + 3 sigmas of blur + shadow offsets) is capped at 8,388,608 pixels per node. Blur and shadow radii are Gaussian sigmas (CSS blur() semantics).
- Backends: static SVG and interactive SVG emit generated, scoped filter defs (feGaussianBlur/feDropShadow/feColorMatrix); native Cairo rasterizes into a node-bounded padded offscreen and applies the identical chain in pixels; interactive Canvas uses the CSS filter chain and is capability-marked partial (when ctx.filter is unavailable the player warns via coenx:renderer-warning and renders without effects).
- Caller-provided SVG filters are never imported; the model carries no raw filter markup. mesh3d nodes cannot carry effects; effects are not animatable. Displacement or custom shader effects do not exist.`,
  masks: `# Reusable alpha masks (WP2, v1)

- Definition: scene.masks[] = { id, width, height, shapes[] } with 1-16 flat shapes.
- Shape: { kind:"rect", x, y, width, height, radius?, fill } | { kind:"ellipse", x, y, width, height, fill } | { kind:"path", commands?|pathRef?, fill, fillRule?, opacity? }. Geometry uses top-left view-box units like path definitions; path shapes may reference scene pathDefinitions (reusing the WP1 resource graph).
- fill: any solid color (alpha from #RRGGBBAA or named/6-digit colors) or linear/radial gradient; only the alpha channel affects the mask. fill:"none" is rejected (it would mask everything away).
- Application: node.maskId references the resource. The mask view box scales onto the node box (same rule as clip paths), the node transform is inherited, node/transition opacity applies after masking, and content outside the node box is hidden. A node may combine clipPathId + maskId (clip cuts geometry first, then the mask multiplies alpha).
- Budgets: 32 masks/scene, 16 shapes/mask, 256 commands per shape path, view box <= 16384 per dimension and <= 4,194,304 pixels.
- Backends: all four (static SVG, interactive SVG, Canvas, native Cairo). SVG emits white-with-alpha shapes so luminance-mask renderers agree with alpha compositing. Canvas and Cairo composite inside a node-box-bounded offscreen surface.
- Luminance masks are NOT implemented (capability-gated off). mesh3d nodes cannot carry masks.`,
  gradients: `# Gradients and paints

- linear: { type:"linear", from:[x,y], to:[x,y], stops[], spread?, transform? } with normalized coordinates (0.5 = node center, allowed range -2..2).
- radial: { type:"radial", center:[x,y], radius>0 <=4, stops[], spread?, transform? } with radius relative to min(node width, height).
- stops: 2-8 entries, ordered offsets 0..1, #RRGGBB(AA) colors, optional opacity 0..1.
- Spread modes: pad (default), repeat, reflect — supported on static SVG, interactive SVG and native Cairo; the interactive Canvas backend implements transforms but only pad spread (explicit partial capability with a player warning).
- Transforms: rotate (degrees), translate and scale per gradient; see the language skill for CML <gradient> attribute syntax.
- Reusable paint resources: scene.paints[] = { id, paint } referenced with { paintRef: "id" } or CML fill="url(#id)"; supported by all four renderers.
- Conic gradients are NOT implemented; the capability matrix reports this.`,
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
