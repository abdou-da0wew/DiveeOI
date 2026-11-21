# Coenx Video

Coenx Video is DiveeOI's serializable motion-graphics, video and interactive-learning composition engine. It has two output paths over one composition model:

- Standard video: the existing SVG/ImageMagick path for the full current node set, plus an opt-in Rust/Cairo frame renderer that streams PNG frames into FFmpeg for MP4 encoding.
- Interactive video: a local HTML player with a Canvas or SVG visual stage, accessible DOM controls, local media and embedded font faces.

## Source authoring

Agent-authored projects can use three files with the same basename:

- project.cml: stage, scenes, vector and text nodes, controls, local assets, audio and education citations.
- project.css: a safe, bounded visual-style subset.
- project.js: a JavaScript-like data module for initial state, event triggers, conditions and actions. It is not executable JavaScript.

The source compiler is exported from the package subpath @diveeoi/coenx-video/format as compileCmlProject. Its parser rejects DTDs, unsupported markup, unsafe CSS and executable script constructs. The script data module compiles into the existing expression/action AST; no eval, Function, imports, callbacks, arbitrary statements or network access are supported.

CLI commands accept either a JSON composition or a CML source file. When a CML file is supplied, matching CSS and JS files beside it are loaded automatically:

    bun packages/coenx-video/src/cli.ts validate lesson.cml
    bun packages/coenx-video/src/cli.ts render lesson.cml --out renders/lesson.mp4 --profile low\n    bun packages/coenx-video/src/cli.ts render lesson.cml --out renders/native.mp4 --profile low --renderer native
    bun packages/coenx-video/src/cli.ts interactive lesson.cml --out exports/lesson

For programmatic use, import compileCmlProject from the format export, then pass its result to renderStandardVideo or compileInteractiveProject. Select renderer: "native" to use the Rust/Cairo MP4 path for rect, ellipse, path, line, text, button, input, local image and projected mesh3d nodes, including linear/radial gradient fills. Select controls still require the default SVG/ImageMagick path.

Read the language reference embedded with the built-in coenx-video-language skill. The bundled skill also includes an example knowledge-check project in all three source files.

## AI-facing validation and capabilities

The package exposes a machine-readable capability matrix from `@diveeoi/coenx-video/capabilities` and a server-safe compiler/validator entry point from `@diveeoi/coenx-video/validation`. DiveeOI registers `coenx_video_capabilities` and `coenx_video_validate` through its canonical built-in tool registry. Agents should check capabilities before selecting a renderer and validate the complete CML or JSON composition before rendering. The capability matrix is code-backed; do not maintain a second hand-written renderer support table in a skill.

The validation entry point deliberately avoids importing browser runtime modules, so server tool consumers do not need DOM libraries. It compiles the restricted CML subset or parses JSON, then calls the shared composition validator without executing project code or accessing media files.

## Built-in font catalogue

The font library is local and bundled. It contains 16 families and 28 WOFF2 assets:

Geist, Geist Mono, Space Grotesk, Space Mono, Manrope, DM Sans, DM Mono, Fraunces, Bricolage Grotesque, IBM Plex Sans, JetBrains Mono, Bebas Neue, Cairo, Tajawal, Amiri and Noto Sans Arabic.

The API is exported from @diveeoi/coenx-video/fonts:

    import { FONT_CATALOG, findFontFamily, recommendFontFamily } from "@diveeoi/coenx-video/fonts"

    const font = findFontFamily("Cairo")
    const recommendations = recommendFontFamily(["arabic", "body"], "arabic")

Every family has its own SIL Open Font License notice in assets/fonts/licenses. The interactive player embeds font CSS and data locally, so it does not request fonts from the network. Arabic families include Arabic and Latin coverage in the manifest. Never assume Inter or a remote system font is available.

## Runtime model

Compositions are versioned JSON-compatible data. Scenes contain positioned visual nodes, frame-based animations, optional camera/physics settings, interaction rules and transitions. A composition also contains audio clips, initial state, events, assets and optional learning provenance.

Interactive expressions are a small validated AST. Supported actions include set, increment, goto, show, hide, feedback, playAudio and emit. The runtime never evaluates project-supplied source code. The exported browser player sends bubbling `coenx:event`, `coenx:state` and `coenx:scenechange` events to its host page. Timer and global timeline actions catch up when the playback clock skips frames; scene-local timers re-arm on scene re-entry while global timeline events remain one-shot.

Educational compositions require provenance.mode = education, a learning objective and at least one citation. A CML educational project must provide retrieved bookId and passageId values on direct citation children of the coenx root. The compiler checks that identifiers are present; the calling Targeted Learning integration remains responsible for grounding them in an actual retrieval result.

## Rendering capabilities and boundaries

2D rectangles, ellipses, polylines, quadratic/cubic vector paths, text, images, buttons, text inputs and selects are supported. Rectangles, ellipses, buttons and paths accept solid colors or shared linear/radial gradient paints. Path commands include moveTo, lineTo, quadraticTo, cubicTo and close, with bounded command counts and finite coordinates. Scenes can define reusable path resources with explicit view-box dimensions, reference them from PathNode values, and reuse them as node-local clip paths. Clip paths support nonzero and evenodd fill rules. Canvas, interactive SVG, standard SVG export and Rust/Cairo native frames resolve the same path resources and clipping geometry. The current 3D layer is a software-projected triangle renderer, not a full scene graph. It now supports perspective cameras, ambient/directional/point lights, flat or subdivided smooth shading, diffuse and Blinn-Phong specular response, material roughness/metalness/emissive controls, morph targets, frame-keyed position/rotation/scale/morph weights, and deterministic 3D gravity/collision simulation.

`Scene.physics3d` supports sphere and axis-aligned box colliders, restitution, friction, angular velocity, substeps and optional world bounds. `Scene.transition` includes fade, slide, zoom, wipe and flip-3D entrance effects. Both Canvas and SVG interactive stages consume the same evaluated 3D keyframes and precomputed physics poses. The Rust/Cairo native MP4 route accepts the same shaded triangle output, vector paths, linear/radial gradients, composites local images and handles scene entrance transforms/clips; select nodes remain unsupported there.

PathNode, reusable path definitions, node-level clipping and GradientPaint are currently part of the lower-level JSON/TypeScript composition model. CML v1 does not yet expose path commands, reusable path definitions, clip-path references or gradient paint literals, so CML-authored projects must continue to use its existing supported node/style subset. This is not yet a complete 3D engine: no glTF import, skeletal/skin animation, joints/constraints, rotation-aware collision shapes, shadow maps, environment reflections, texture maps, physically based BRDF pipeline, volumetrics or GPU scene graph. Smooth shading is currently approximated through small subdivided triangles. The current CPU projection pipeline is not a Three.js/R3F port; that remains a later renderer backend consuming the same compiled scene model. Use a supplied image for unsupported assets or disclose the gap instead of implying arbitrary 3D features exist.

The default MP4 path remains SVG plus ImageMagick for broad compatibility and FFmpeg for encoding. ImageMagick is a compatibility rasterizer/decoder, not a 3D renderer. The pinned Q8 Linux runtime can be installed for packaging with `bun run vendor:imagemagick` on the matching Linux architecture into `vendor/imagemagick/<platform>-<arch>/`; the script verifies the upstream SHA-256, version, required SVG/complex-text delegates and shared-library availability. The resolver prefers `COENX_VIDEO_MAGICK`, then the packaged `bin/magick`, then the system `magick` command. The official portable Linux archive still relies on host glibc and `libgomp`, so it is not fully static. The Rust/Cairo native path is opt-in with `renderer: "native"`; Rust owns per-frame composition and image placement, while ImageMagick decodes unsupported source formats to bounded PNG assets once per unique image. Local images and data-image URIs are supported; remote paths, project-root escapes, external SVG references and select nodes are rejected. The renderer bounds decoded dimensions and caches Cairo image surfaces. A future Skia-backed native 2D backend remains a candidate to benchmark for richer paths, shaders, filters, codecs and text layout. Do not replace Cairo until parity tests and packaging/performance benchmarks justify it.

Audio is mixed into MP4 by FFmpeg and scheduled against the interactive frame clock. Coenx itself does not generate narration, music or sound effects. It can use media created by a configured external provider and attached as a local asset.

## Bundled agent guidance

DiveeOI registers 19 Coenx video skills through the built-in resource registry in packages/db/src/plugin/skill/bundled/coenx-video/index.ts. They cover the production entry point, visual styles, three explainer variants, B-roll, object separation, sound design, the source language, interactive Canvas, SVG motion, motion design, typography, font selection, accessibility, Targeted Learning, physics, storyboarding and validation.

The workspace-facing mirror is in .agents/skills/. Bundled resources include the full 17-style prompt library, style capability map, authoring reference, example project, font manifest, local WOFF2 files and their individual license notices.

## Validation

Run the package checks from the workspace:

    cd packages/coenx-video
    bun test test/format.test.ts
    bun run typecheck
    bun run lint

The native sidecar can be built with bun run build:native. Its Linux build/runtime needs Cairo, Pango, PangoCairo and Fontconfig development/runtime libraries. Run cargo fmt, test and clippy in native/coenx-video-native. The native frame renderer uses Cairo for vector rasterization and Pango for script shaping; TypeScript evaluates keyframes and streams PNGs to FFmpeg. Verify rendered output with ffprobe and inspect representative frames; a successful process exit alone is not sufficient.
