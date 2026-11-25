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
- CML v1 does not yet expose path commands, reusable path definitions, clip-path references, gradient-paint literals or `mesh3d`. Do not invent undocumented CML syntax for these features.
- Reusable alpha masks (WP2, v1) are supported by all four renderers. A mask is a scene-level `masks[]` resource with a view box and 1-16 flat shapes (rect/ellipse/path, path shapes may reference scene path definitions). Alpha comes from paint alpha only; luminance masks are not implemented.
- Mask semantics: the mask view box scales onto the referencing node's box, the node transform is inherited, node/transition opacity applies after masking, and content outside the node box is hidden. Masked nodes composite inside a node-box-bounded offscreen on Canvas and native Cairo.
- Attach masks with the node's `maskId` field; a node may combine `clipPathId` (geometry cut) with `maskId` (alpha multiply). A dangling `maskId` is a validation error, never a silent skip.
- Filter effects are not yet implemented. Do not claim SVG filter support just because SVG as an output format can represent them.
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
