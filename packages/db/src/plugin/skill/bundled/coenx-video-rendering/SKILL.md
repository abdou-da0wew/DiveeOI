---
name: coenx-video-rendering
description: Use when checking Coenx Video renderer support, validating a project, choosing an output backend, or diagnosing unsupported visual features.
---

# Coenx Video rendering and validation

Use the canonical Coenx Video tools before committing to a renderer or claiming a feature is supported.

## Required workflow

1. Call `coenx_video_capabilities` before choosing an output target or using features whose backend support is uncertain.
2. Author one shared Coenx Video composition. Prefer CML for its currently supported node/style subset. Use structured JSON/TypeScript composition data when the project needs capabilities not exposed by CML, such as vector paths, reusable paths, clip paths or gradient paint values.
3. Call `coenx_video_validate` on the complete CML or JSON source before requesting any render. Repair every error diagnostic and validate again.
4. Choose a backend only from the capability response. Do not silently downgrade or remove unsupported features. Explain the fallback or ask for a compatible output choice when no backend supports a required feature.
5. Keep local project assets inside the project root. The current validation tool validates composition data; it does not resolve, download or inspect media files.

## Current renderer facts

- Static SVG/ImageMagick/FFmpeg is the compatibility MP4 path.
- Rust/Cairo/Pango/FFmpeg is the opt-in native CPU frame path. Native select controls are not supported.
- Interactive playback offers Canvas and SVG browser renderers.
- Inline paths and reusable scene-level path definitions are available in the structured model. Path references map their declared view box into the node's local bounds.
- Reusable node-local clip paths are supported by all four output renderers. They support `nonzero` and `evenodd` fill rules. A 2D clip path cannot be attached to a `mesh3d` node.
- Linear and radial gradients are available in the structured model. Spread modes (pad/repeat/reflect) and gradient transforms (rotate/translate/scale) are supported by static SVG, interactive SVG and native Cairo. The interactive Canvas backend implements transforms but only pad spread (explicit partial capability with a player warning). Reusable scene-level paint resources ({ paintRef } / CML <gradient>) are supported by all four renderers. Conic gradients are not implemented.
- CML exposes reusable paths, clip paths, masks, gradient paint resources and the bounded `filter` attribute through `<defs>`/node attributes; `mesh3d` remains structured-JSON-only. Do not invent undocumented CML syntax for anything else.
- Reusable alpha masks (WP2, v1) are supported by all four renderers. A mask is a scene-level `masks[]` resource with a view box and 1-16 flat shapes (rect/ellipse/path, path shapes may reference scene path definitions). Alpha comes from paint alpha only; luminance masks are not implemented.
- Mask semantics: the mask view box scales onto the referencing node's box, the node transform is inherited, node/transition opacity applies after masking, and content outside the node box is hidden. Masked nodes composite inside a node-box-bounded offscreen on Canvas and native Cairo.
- Attach masks with the node's `maskId` field; a node may combine `clipPathId` (geometry cut) with `maskId` (alpha multiply). A dangling `maskId` is a validation error, never a silent skip.
- Bounded filter effects (WP4, v1) are supported by static SVG, interactive SVG and native Cairo; interactive Canvas is an explicit partial capability (CSS filter chain, feature-detected; when `ctx.filter` is unavailable the player emits a `coenx:renderer-warning` and renders without effects). The accepted chain is at most 4 effects per node: blur (sigma 0..64), drop-shadow (dx/dy within +/-128, sigma 0..32, #RRGGBB(AA) color), color-adjust (brightness/contrast/saturate 0..4, hueRotate +/-360). Effects apply to node content BEFORE clipping, masking and opacity, in list order. The padded temporary surface is capped at 8,388,608 pixels per node; validation rejects chains beyond it. Caller-provided SVG filters are never imported. mesh3d nodes cannot carry effects; effects are not animatable.
- Current 3D is CPU software projection. It supports perspective cameras, basic lights/material response, morph targets, frame-keyed transforms and deterministic physics.
- GPU 3D is planned, not available. The intended architecture is a browser Three.js/WebGL2 backend (WebGPU optional) and a native Rust/wgpu backend, both consuming one scene contract. The existing CPU renderer must remain the fallback for missing/blocked/lost GPU devices and headless rendering.
- glTF loading, skeletal/skin animation, shadow maps and a full PBR pipeline are not currently available.

## Tool contract

### `coenx_video_capabilities`

No arguments. Returns a machine-readable capability matrix with renderer targets, supported feature IDs, limitations, authoring-format gaps and the current/planned 3D paths. Treat the returned data as the source of truth rather than relying on older examples or prose.

### `coenx_video_validate`

Input:
- `format`: `cml` or `json`
- `source`: complete markup or serialized `VideoComposition`
- `styles` and `script`: optional CML companions only

The tool compiles and validates the composition, but never renders or executes user code. It returns `valid`, structured diagnostics and, when valid, stage dimensions, frame rate, scene count, node count and total frames. The combined source is limited to 2 MiB. JSON input must not include CML companion files.

Preview/export/inspect tools are separate future additions. Do not call or promise tool names that are absent from the active tool catalogue.

## Native sidecar: build state and when it helps

The Rust sidecar (`packages/coenx-video/native/coenx-video-native`, built with `bun run build:native` or `cargo build --release --manifest-path native/coenx-video-native/Cargo.toml`) was built and verified 2026-11-27 with Rust 1.100.0 (607 KB binary linking system cairo/glib/pango). It serves the headless export path only: `simulate` batches physics and `render_frame` rasterizes through cairo in one process. It never participates in interactive playback — the browser cannot spawn children and a per-frame JSON round-trip would regress the player hot path, which stays on the in-process JS `LivePhysicsWorld` (measured 0.0389 ms/step on the 44-body bench, vs 0.083 ms/step end-to-end for the sidecar on the same 900-step batch where spawn + serialization of 901 frames x 44 poses dominate).

Rules for agents:
- After changing the Rust sidecar or the physics hot path, re-run BOTH benches: `bun scripts/bench-live-physics.ts` and `bun scripts/bench-native-physics.ts` (inside `packages/coenx-video`). Report both numbers; the sidecar bench includes spawn + JSON overhead by design.
- Do not claim the native path is active unless `native/coenx-video-native/target/release/coenx-video-native` (or `$COENX_VIDEO_NATIVE`) exists; otherwise `simulatePhysics` falls back to TypeScript silently and `renderNativeFrame` fails fast.
- On a machine without cargo, say the native path needs a build step; never fake a binary or claim renderer parity without the build.
