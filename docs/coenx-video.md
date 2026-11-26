# coenx-video: architecture and agent skills

`@diveeoi/coenx-video` is the shared code-authored video engine intended for both the general-purpose agent and Targeted Learning. Its model supports two distinct output contracts: ordinary MP4 and an interactive browser project.

## Package layout

- `packages/coenx-video/src/model/`: serializable composition types and validation.
- `src/authoring/`: TypeScript scene and node builders.
- `src/animation/`: deterministic frame/keyframe evaluation.
- `src/interactive/`: safe expression AST and state/event/action engine.
- `src/runtime/`: Canvas drawing, HTML form controls and interactive playback.
- `src/render/`: SVG scene drawing, CPU 3D projection/lighting, native Cairo frame bridge, audio filter graph and FFmpeg MP4 renderer.
- `src/physics/` and `src/native/`: 2D and 3D TypeScript physics, plus the batched Rust sidecar client.
- `src/compiler/`: interactive project packaging.
- `native/coenx-video-native/`: Rust sidecar for deterministic batched physics and Cairo/Pango frame rasterization.

See `packages/coenx-video/README.md` and `packages/coenx-video/AGENTS.md` for code contracts and commands.

## Two output pipelines

### Standard video

The author creates one versioned `VideoComposition`. Validation checks the stage, nodes, animations, interactions, audio and resource profile. The renderer evaluates scene frames, rasterizes bounded SVG batches, sends raw RGB frames to FFmpeg, muxes local audio tracks and verifies the completed MP4 with ffprobe before finalizing the output path. The result is an ordinary MP4 and does not need the DiveeOI player.

### Interactive video

The compiler packages the same composition model as JSON plus a bundled browser player. Playback draws Canvas visuals and positions real HTML buttons, inputs and selects above the canvas. A restricted expression AST evaluates conditions, while actions update state, change scenes, show/hide nodes, emit events, show feedback and trigger audio. It does not evaluate arbitrary JavaScript from a composition.

The compiled project is a web deliverable, not an MP4. Serve it over HTTP so the player can fetch its JSON and media. The embedding page receives bubbling `coenx:event`, `coenx:state` and `coenx:scenechange` events; the player handle also exposes state and playback controls. Frame timers and global timeline events catch up when playback skips frames, and scene-local timers re-arm on scene re-entry. This is a first-class product direction, but application-level persistence, student progress integration, permission-aware tool registration and broad device QA remain integration work before it should be described as production complete.

## World model (interactive scenes as worlds)

Scenes can behave like small worlds. The interaction model supports:

- **Triggers**: `click`, `submit`, `change`, `key`, `timer`, plus `hover` (with optional `phase: "enter" | "leave"`), `drag` (with optional `phase: "start" | "move" | "end"`, fired after a 4px threshold with grab-offset tracking so bodies do not jump) and `collide` (fired by the live physics step once per new overlap, with optional `withId`).
- **Expressions**: comparisons and boolean logic, arithmetic (`add`/`sub`/`mul`/`div`/`mod`), `concat`, `min`/`max`, `abs`/`round`/`floor`/`ceil`, `clamp`, bounded `random` and a ternary `if`. Actions can reference the triggering event's pointer coordinates (`event.x` / `event.y`).
- **Actions (statements)**: `set`, `increment`, `goto`, `gotoFrame` (scene-local), `show`/`hide`, `run` (nested statement lists, depth-bounded), `setNode` (text/x/y/rotation/opacity/scale/color overrides that beat keyframe animation), `impulse` (adds velocity to a live physics body), `feedback`, `playAudio` and `emit`. Overrides are snapshotted per scene and restored on navigation, like hidden-node state.

Scenes with `physics` settings run a **live 2D world** in the player (`src/physics/live.ts`): gravity, mass/restitution, circle/box collision with positional correction, kinematic drag bodies that keep a fling velocity on release and once-per-overlap collision events that dispatch `collide` interactions. Positions use runtime node-center coordinates; poses override node x/y for rendering and hit-testing. The static MP4/SVG routes keep using the pre-baked batched simulation (`simulatePhysics`), so rendered output stays deterministic.

`setNode` overrides and physics poses are applied in both Canvas and SVG stage renderers through `src/runtime/overrides.ts`; the player hit-tests against the overridden geometry, so interactive targets track moved nodes. `.coenx4` containers can also be unpacked entirely in the browser (`src/container/browser.ts`, PK-ZIP + `DecompressionStream`, CRC-verified) — no node APIs on the playback path.

**DiveeOI integration.** The session side panel plays `.coenx4` files directly: `VideoPreviewPanel` routes them to `CoenxInteractivePanel`, which unpacks the container via the file endpoint and mounts the bundled runtime player. Completions of `coenx_video_export`, `coenx_video_pack` and `coenx_video_lesson` auto-open a preview tab.

**Targeted Learning integration.** `coenx-video/learning` (`createInteractiveLesson`) builds grounded lessons from TL-shaped specs: an intro scene, one retry-on-wrong quiz scene per question with live score, `tl:answer:correct` / `tl:answer:wrong` / `tl:lesson:complete` emits and a graded results scene with replay; citations ride in `provenance`. The `coenx_video_lesson` tool is on the targeted-session allowlist and documented in the grounding system prompts. The e2e in `packages/coenx-video/test/world-demo.test.ts` drives clicks, hovers, drags, live physics and collision events in headless Chromium.

## Rust and resource policy

TypeScript owns authoring, validation, orchestration, control surfaces and interactive events. Rust is reserved for repeated, data-oriented simulation work. Physics is sent to the sidecar in a single batch and can fall back to TypeScript. Do not fork a process once per frame.

Render profiles cap the width/height/fps/frame/node counts, memory held by raster batches, native threads and concurrent standard renders. Use low profile for previews. Browser playback caps frame rate and device pixel ratio and pauses when the player is hidden. Optional segmentation/model workflows require user approval and must not start automatically.

## Agent skill discovery

The project-level skill set is stored in `.agents/skills/`. The server's existing skill discovery scans `skills/**/SKILL.md` under `.agents`, so the following are visible as ordinary project skills:

- `coenx-video` — mandatory video-production entry point and output routing.
- `coenx-video-styles` — style library and compatibility mapping for 17 named looks.
- `coenx-video-explainer-default`, `coenx-video-explainer-engaging`, `coenx-video-explainer-high-energy` — product/story formats.
- `coenx-video-motion-broll` — transcript-aligned standalone motion inserts.
- `coenx-video-object-separation` — optional local foreground-extraction preparation.
- `coenx-video-sound-design` — licensed SFX, music, voice and interactive cues.

The general agent can discover these skills through the existing Skill service. The canonical DiveeOI tool catalogue registers `coenx_video_capabilities` and `coenx_video_validate` through `packages/db/src/tool/builtins.ts`: the first returns the code-backed per-renderer feature matrix, and the second compiles/validates CML or JSON compositions and returns structured diagnostics. These tools use the canonical `Tool.make` / `Tools.Service.register` architecture; they do not create a parallel tool system. Their package dependencies use the server-safe `@diveeoi/coenx-video/capabilities` and `@diveeoi/coenx-video/validation` subpaths rather than importing browser-only runtime types.

The `coenx-video-rendering` skill is available project-locally and as a bundled skill. It requires agents to discover capabilities, validate, and disclose backend limitations. Preview, inspect, export, server API routes, UI authoring surface and Targeted Learning handoff remain separate integration work and must be added through the same canonical tools and permissions path.

## External research and licenses

The source snapshots and all 17 complete style prompts are archived under `docs/research/motion-graphics/`. Barty-Bart's repository is cloned under `third_party/motion-graphics/` at a pinned commit and retains its MIT LICENSE. Fonts, icons, sounds and music have additional source-specific licenses and credit files; do not assume the entire media directory inherits MIT. Awesome Claude's page explicitly permits reuse of its prompt templates; its prompt archive retains attribution and the source update date instead of inventing an SPDX license.

See `docs/research/motion-graphics/README.md` for the archive inventory, exact source revision, license notes and offline page instructions.

## Source authoring language

Agent-authored compositions can use three source files with the same basename: .cml for stage/scenes/nodes, .css for a deliberately bounded visual style subset, and .js for a JavaScript-object-literal event module. The compiler maps these into the shared VideoComposition model.

The format entry point is compileCmlProject from @diveeoi/coenx-video/format. It rejects unsupported tags/selectors/properties and executable JavaScript. The script file accepts initial state, event triggers, conditional expression trees and validated actions; it is not a general JavaScript runtime. This keeps generated lesson source deterministic and prevents arbitrary generated-code execution. See the built-in coenx-video-language skill's references/authoring-language.md resource and its knowledge-check example.

CML v1 currently exposes rect, ellipse, line, text, image, button, input and select nodes. The lower-level JSON/TypeScript composition API additionally supports inline and reusable PathNode geometry (moveTo, lineTo, quadraticTo, cubicTo and close), scene-level path definitions, reusable node-local clip paths with nonzero/evenodd fill rules, and linear/radial GradientPaint values on rectangles, ellipses, buttons and paths. These features are not yet exposed as CML literals. The lower-level API also supports mesh3d, which is not exposed by the CML compiler. Never promise arbitrary SVG filters, masks, arbitrary CSS or arbitrary JavaScript in CML v1.

## Bundled typography

The package bundles 16 font families and 28 WOFF2 files: Geist, Geist Mono, Space Grotesk, Space Mono, Manrope, DM Sans, DM Mono, Fraunces, Bricolage Grotesque, IBM Plex Sans, JetBrains Mono, Bebas Neue, Cairo, Tajawal, Amiri and Noto Sans Arabic. Font metadata and family-specific SIL Open Font License notices live under packages/coenx-video/assets/fonts/.

The browser player embeds WOFF2 data in local @font-face declarations. The MP4 renderer writes only the selected fonts to a temporary Fontconfig directory. Neither output uses Inter or requires remote font requests or host-installed fonts. Arabic families include dedicated Arabic and Latin font subsets.

## Built-in DiveeOI skills

The 20 Coenx skills are registered in packages/db/src/plugin/skill/bundled/coenx-video/index.ts and spread into the existing built-in skill catalogue. They include the source-language guide, interactive Canvas and SVG motion guides, animation, typography/fonts, accessibility, Targeted Learning, physics, storyboarding, validation, renderer/capability workflow, and the adapted visual-style/explainer/B-roll/object-separation/sound-design guidance. Font binaries, license notices, the full style-prompt library, capability map, authoring reference and example project are embedded as built-in skill resources.

## Native renderer milestone

The package includes a Rust/Cairo frame rasterizer using Pango/PangoCairo for complex-script text shaping. Its line protocol accepts render_frame requests and writes PNG files. TypeScript evaluates keyframes and 3D mesh lighting, tessellates projected faces into ordered polygon primitives, prepares local image assets, and sends frames through one persistent Rust process. Rust owns per-frame drawing, image placement/cropping, rectangle/ellipse/path fills, linear/radial gradient paints, quadratic/cubic path curves, fill rules, reusable path geometry resolved by TypeScript, node-local clipping, transforms, z-order and composition. Path commands, path resources and clip geometry share the same validated model across Canvas, interactive SVG, standard SVG export and native Cairo. ImageMagick is only used to decode unsupported source formats into bounded PNGs once per unique asset; FFmpeg receives the PNG frame stream, mixes the audio graph and encodes the MP4, which is verified with FFprobe. Select it with renderer: "native" or --renderer native. The default SVG/ImageMagick path remains available for broader node compatibility.

The current 3D path is CPU perspective projection over triangle meshes. It supports flat/smooth shading, ambient/directional/point lights, diffuse/specular material response, morph targets, animated 3D position/rotation/scale/morph weights, and 3D physics with gravity, AABB/sphere collision, friction, restitution, angular velocity, substeps and optional world bounds. Scene entrance transitions include fade, slide, zoom, wipe and flip-3D. The same animation and physics evaluation is used by Canvas, SVG, standard SVG/ImageMagick export and native Cairo export.

This remains a lightweight software 3D layer, not a GPU-accelerated renderer or a full PBR renderer. The planned 3D work is deliberately deferred behind the shared 2D renderer and AI authoring/tool contracts: a browser Three.js/WebGL2 backend (with WebGPU as an optional capability) and a native Rust/wgpu backend will consume the same compiled scene model, while the existing deterministic CPU renderer remains a supported fallback for headless, unsupported, low-memory or device-loss cases. React Three Fiber is not required by the current browser runtime; an adapter can be added for a React host if one exists. The current path does not yet load glTF, animate skeletons/skins, solve joints/constraints, use rotation-aware collision shapes, produce shadow maps or perform environment/texture mapping. Smooth shading is approximated with tessellated triangles. Native Cairo now composites local image assets, vector paths, reusable clip paths and gradient fills as well as mesh polygons and scene transforms/clips; select controls remain unsupported on the native MP4 route. Alpha/luminance masks, filter graphs and complete node parity are not yet implemented. The interactive player offers Canvas and SVG stage renderers; Canvas remains default and SVG creates inspectable vector DOM nodes with accessible HTML control overlays. The browser runtime exposes state changes through onStateChange, emitted application events through onEvent and bubbling coenx:event DOM events, and preserves hidden-node state per scene. Timer interactions evaluate their optional condition before consuming the timer.

## Renderer strategy

ImageMagick remains the compatibility rasterizer on the default export route. A pinned Q8 Linux runtime can be installed for release packaging with `bun run vendor:imagemagick`; the installer verifies the official SHA-256 and checks SVG, Pango/RaQM text delegates and shared-library availability. The resolver prefers an explicit `COENX_VIDEO_MAGICK`, then the packaged `bin/magick`, then the system executable. The tested portable GNU/Linux archives still depend on host glibc and `libgomp`, so they are not fully self-contained. The upstream default security policy is permissive; apply a deployment-specific restrictive policy and resource limits before processing untrusted project assets. ImageMagick is not a 3D renderer. For a richer native 2D pipeline, benchmark Skia before committing: it exposes vector paths, effects/shaders, codecs, SVG, text layout/shaping and optional GPU backends, but introduces a significantly heavier native dependency and packaging matrix. Keep Cairo/Pango as the current native baseline until quality, throughput, memory and distribution measurements justify a switch. The future interactive 3D scene graph should be a separate Three.js integration; do not overload the current CPU projection layer or claim the R3F/Three.js port exists yet.
