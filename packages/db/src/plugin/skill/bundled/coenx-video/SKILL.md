---
name: coenx-video
description: Create, author, validate, render and deliver code-authored videos and interactive lessons using DiveeOI's coenx-video package. Use whenever a user asks for a video, animation, explainer, motion graphic, product demo, B-roll graphic, educational visual, interactive lesson or video-generation workflow.
---

# coenx-video: the production entry point

Use the shared DiveeOI composition model. Do not default to an external video-generation model or to a generic HTML/Playwright renderer. The package owns authoring, validation, standard MP4 export and interactive project export.

The original workflow ideas were adapted from Barty-Bart's MIT-licensed motion-graphics repository (see ../../../third_party/motion-graphics/README.md) and the Awesome Claude motion-graphics style collection. Copyright and third-party license notices are retained in the upstream archive and research index (../../../docs/research/motion-graphics/README.md).

## 1. Choose the output contract

- **Standard video is the default.** Deliver an ordinary MP4 that plays in normal video players. It has no custom runtime dependency.
- **Interactive video** is for lessons, exercises, guided demos and other experiences where the viewer must act. Deliver the compiled project folder with index.html, composition.json, manifest.json, the bundled runtime and local media.
- If the user asks for "a video" without specifying interaction, use standard MP4. Do not make a user download a web app just to watch a video.
- For Targeted Learning, prefer interaction when the learning objective depends on student input or feedback. Reuse the same composition engine; do not build a second educational renderer.

## 2. Get only essential facts

Use context already supplied. Ask one concise clarification only when the missing fact changes the result. Otherwise make and state a sensible default.

Useful constraints: subject and intended takeaway, audience, destination/aspect ratio, approximate duration, product facts or learning sources, brand assets, and audio preference. Never invent product capabilities, statistics, citations, quotations, scientific claims or answer keys.

For education, use retrieved book passages and exact citation identifiers. Keep evidence and citations attached to the composition's educational provenance. Put learner-facing citations in the composition as visible source notes where appropriate; metadata alone is not a visible citation.

## 3. Storyboard before authoring

Create a compact shot/scene plan before writing code:

| Field    | Requirement                               |
| -------- | ----------------------------------------- |
| Scene    | Stable, unique scene id                   |
| Frames   | Start/end or duration at the chosen fps   |
| Purpose  | One idea the viewer should understand     |
| Visual   | What is actually drawn or shown           |
| Copy     | Exact words/numbers to render             |
| Motion   | Entry, hold, action and exit              |
| Audio    | Music, narration or specific SFX cue      |
| Evidence | Source IDs for factual/educational claims |

Open on a clear hook, give every important idea enough reading time, and end with a deliberate hold. Do not use constant motion to disguise a weak story. Keep one visual hierarchy per scene.

## 4. Author with the package API

Package root: packages/coenx-video/. Read its README.md and AGENTS.md before editing it.

Public API includes:

- createComposition, createScene, rect, ellipse, text, button, addNode
- validateComposition, RENDER_PROFILES
- renderStandardVideo, compileInteractiveProject
- mountInteractivePlayer, InteractiveEngine, evaluateExpression
- simulatePhysics, createEducationalVideo

Composition format is version 1. Use frame units for animation, duration, audio start and interaction timers. Avoid wall-clock timers in the composition model.

Core node types: rect, ellipse, line, text, image, button, input, select, and mesh3d. A scene can also own a camera, `lights3d`, 2D/3D physics settings, interactions and a transition. Audio lives on composition tracks.

For lower-level `mesh3d` compositions, provide finite vertices and valid triangle indices. Morph targets must preserve the base vertex count. Use `material` for flat/smooth shading, roughness, metalness, specular response, emissive color and wireframe. Add ambient/directional/point sources in `lights3d`. Animate `positionX3d`, `rotationY3d`, `scaleZ3d` or `morph:targetName` with ordinary frame-based keyframes. Attach `physics3d` bodies when motion should respond to gravity or collisions; avoid keyframing the same transform components at the same time.

## 5. Standard MP4 workflow

1. Author the composition and keep assets project-relative.
2. Validate it before rendering.
3. Render a low-cost draft first, inspect the result, then render final quality only once the content is correct.
4. Verify the MP4 with ffprobe and inspect a few frames at the start, middle, transitions and end.
5. Deliver the MP4 path and disclose any intentionally omitted narration, missing assets or unsupported effects.

CLI:

- bun packages/coenx-video/src/cli.ts validate project.json
- bun packages/coenx-video/src/cli.ts render project.json --out renders/draft.mp4 --profile low
- bun packages/coenx-video/src/cli.ts render project.json --out renders/final.mp4 --profile balanced

Use low for first-pass checks, balanced for normal delivery and quality only when the actual output needs it and the device can handle it. Never launch simultaneous renders. Keep output and temporary media under a project-owned directory.

## 6. Interactive lesson workflow

1. Define initial state and stable identifiers for scenes, controls, interactions and audio tracks.
2. Use only the supported expression AST: literal/state/event values, comparisons, boolean operations and contains. Do not use eval, Function, dynamic imports or code strings from compositions.
3. Use triggers click, change, submit, key and scene-local timer. Available actions: set, increment, goto, show, hide, feedback, playAudio, emit.
4. Keep answer keys and private grading data out of learner-visible composition JSON. The interactive package is a client experience, not a secure exam-grading backend.
5. Compile with compileInteractiveProject. Open the export over a local HTTP server, not directly through file:// because browser fetch restrictions can block the JSON composition.
6. Test each happy path, wrong answer, repeated click, scene change, pause/resume, hidden tab and narrow viewport.

CLI:
bun packages/coenx-video/src/cli.ts interactive project.json --out exports/lesson

## 7. Audio and speech

Choose the smallest audio treatment that helps the story:

- Music only for atmosphere or pacing.
- A few intentional SFX for meaningful actions or transitions.
- Narration when language is necessary to explain a concept or accessibility requires it.
- Text and diagrams are often clearer than unnecessary voiceover.

The package mixes supplied local audio into MP4 and schedules tracks in the interactive runtime. It does not itself generate speech/music. Use an available TTS or audio-generation provider only when one is actually configured; save its output as a local asset and cite/credit source material where required. Never pretend generated narration exists when only a text node was rendered.

## 8. Current renderer boundaries

The engine is intentionally foundational:

- 2D primitives and text are native.
- 3D is a CPU-projected triangle-mesh path with ambient/directional/point lights, flat or subdivided smooth shading, diffuse/specular materials, morph targets and keyframed 3D transforms. It is not a Three.js scene graph or a full PBR engine.
- 3D physics supports gravity, AABB/sphere collision, friction, restitution, angular velocity, substeps and optional world bounds. It does not yet provide joints, constraints or rotation-aware collision shapes.
- Scene entrance transitions include fade, slide, zoom, wipe and flip-3D.
- The standard renderer currently uses still image assets, SVG drawing and FFmpeg. It does not yet composite arbitrary source video clips, render browser DOM, provide custom GLSL/WebGL post-FX, path-morph arbitrary SVG, or generate media.
- Custom bezier curves, blur, particle systems, brush simulation, depth-of-field, motion blur, transparent ProRes overlays and arbitrary CSS/GSAP are not currently native composition features. Use a pre-rendered local image asset where appropriate, simplify the visual, or clearly report the missing capability. Never imply the package has a working API for an absent feature.

Do not import a complete external renderer to bypass these limits without an explicit architecture decision.

## 9. Resource rules

- Use the render profiles and one active render at a time.
- Keep dimensions/fps proportional to the destination. Draft at low, avoid unnecessary 4K/60 fps.
- Prefer a single Rust physics batch over per-frame process calls. Use TypeScript fallback if the sidecar is absent.
- Keep asset sizes bounded; prefer WebP/PNG/JPEG images appropriate to the scene.
- Use the bundled Coenx font catalogue. Never fall back to remote font URLs or assume Inter is installed. For optional large models or footage, ask before installation.
- Stop work on user cancellation and do not leave partial output files behind.

## 10. Review checklist

- Is every displayed fact grounded?
- Does each scene communicate one point?
- Are all words large and visible long enough on a phone?
- Does each scene have a deliberate entry and exit?
- Is all audio synchronized and within safe levels?
- Are local assets present and packaged?
- Does the standard MP4 play without DiveeOI?
- Does the interactive project actually respond to every defined event?
- Does the output fit the chosen resource profile?

Deliver the artifact, the chosen output type, resolution/fps/duration and any remaining limitations.

## 11. Coenx source language

Prefer the three-file declarative authoring format for agent-generated video projects:

- project.cml defines the stage, scenes, visual nodes, assets, audio and education citations.
- project.css defines the supported static visual style subset.
- project.js defines initial state, triggers, conditions and interaction actions as a restricted data module.

Read the bundled coenx-video-language skill and its references/authoring-language.md resource before authoring these files. Compile with compileCmlProject from @diveeoi/coenx-video/format. This source compiler is not a general HTML/CSS/JavaScript runtime. Never add eval or arbitrary JavaScript execution.

The format is deliberately strict: stable IDs, project-relative media, safe selectors, allowed CSS properties, supported node types, validated event/action AST and retrieved citation identifiers only. If a feature is unsupported, represent it with supported primitives, use a supplied local asset, or disclose the limitation.

## 12. Bundled fonts

The package includes a local font catalogue and embeds its WOFF2 assets into interactive exports. Use FONT_CATALOG, findFontFamily and recommendFontFamily from @diveeoi/coenx-video/fonts. Choose according to typography role and script coverage. Use Cairo, Tajawal, Amiri or Noto Sans Arabic for Arabic text; verify mixed Arabic/Latin shaping, numerals, punctuation and right-to-left composition.

Do not add Inter as a default, do not reference Google Fonts URLs, and do not use a font outside the catalogue unless a user supplies it and its license/use is confirmed. The font skill exposes the complete manifest and per-family SIL Open Font License resources.

## 13. Renderer selection

The standard MP4 renderer defaults to the SVG/ImageMagick implementation, which currently handles the broader existing node set. The optional Rust/Cairo/Pango renderer is selected with renderer: "native" or CLI --renderer native. It handles rectangles, ellipses, polylines, text (including Arabic shaping), images, buttons, input placeholders, inline/reusable vector paths, reusable node-local clip paths, gradients and CPU-projected mesh3d polygons. It rejects select nodes. Both standard renderers use the same evaluated morph/transform animation and 3D physics poses. Never silently switch renderers or claim complete native parity. Use SVG/ImageMagick for compositions containing select nodes.

Interactive export has two visual stages: Canvas (default, preferred for dense visual scenes) and SVG (preferred for crisp, inspectable vector scenes). Select with compileInteractiveProject renderer: "svg" or mountInteractivePlayer renderer: "svg". Both share the same composition, timeline and interaction engine; real buttons, inputs and selects remain accessible HTML overlay controls.

## 14. Current authoring boundaries

The three-file source compiler currently supports rect, ellipse, line, text, image, button, input and select nodes. The lower-level composition model also supports mesh3d, but it is not exposed through CML v1. Do not suggest a mesh3d element in CML. Animation declarations belong inside the visual element they animate.

The .js source currently uses JavaScript object-literal syntax as a declarative event module. It is not a general JavaScript runtime and does not accept functions or arbitrary expressions. Express interaction logic with state, triggers, when expression trees and the validated action list. This prevents lesson source from executing arbitrary code.

## 15. Built-in video skills

Use the focused skill for the task rather than loading every guide at once: coenx-video-language, coenx-video-interactive, coenx-video-svg-motion, coenx-video-motion-design, coenx-video-typography, coenx-video-fonts, coenx-video-accessibility, coenx-video-learning, coenx-video-physics, coenx-video-storyboard and coenx-video-validation. The source-derived explainer, B-roll, object-separation, sound-design and visual-style skills are also bundled with DiveeOI.


## 16. AI capability discovery and source validation

The canonical DiveeOI tool catalogue now exposes `coenx_video_capabilities` and `coenx_video_validate`. Load the `coenx-video-rendering` skill when the task depends on backend support or visual-feature compatibility.

Before authoring a complex renderer-specific feature, call `coenx_video_capabilities`. The capability document is generated from `@diveeoi/coenx-video/capabilities`; it is the source of truth for backend feature support and authoring-language gaps. Do not infer that a browser/SVG standard supports a feature just because SVG syntax exists.

Call `coenx_video_validate` with the complete CML or serialized JSON composition before rendering. It compiles CML through `@diveeoi/coenx-video/validation`, validates the shared composition model, enforces a 2 MiB combined source bound, and returns structured diagnostics plus a stage/scene/frame summary. It does not render, access project files, fetch media or execute JavaScript.

Current capability boundary: reusable paths, node-local clipping (nonzero/evenodd), reusable alpha masks, gradient spread/transform/paint resources, and the bounded effect chain (blur, drop-shadow, color-adjust) exist in the structured model and current renderers. CML exposes them through `<defs>` resources and node `clip`/`mask`/`filter` attributes; mesh3d stays JSON-only. Luminance masks and GPU 3D are not implemented. Current 3D uses CPU software projection. GPU 3D remains planned; never claim that a GPU path is active. The future browser Three.js/WebGL2 and native Rust/wgpu implementations must share a scene contract and preserve the deterministic CPU fallback.

Preview, inspect, export and reference tools are registered separately from the capability/validation pair; check the live tool definitions before promising them.
