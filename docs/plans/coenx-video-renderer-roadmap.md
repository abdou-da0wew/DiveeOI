# Coenx Video Renderer and AI Tooling Roadmap

**Status:** Active, living implementation plan  
**Last reconciled:** 2026-11-21  
**Workspace:** `/home/ababado/DiveeOI-ai-learning-update`  
**Branch:** `dev`  
**Owner:** Coenx Video engineering  
**Current execution lane:** Shared 2D/vector renderer semantics and authoring parity  
**Deferred lane:** Full GPU-accelerated 3D backend with deterministic CPU fallback

This file is the persistent source of truth for the renderer work. Read it before resuming this project. Keep the status, next action, decision log, and verification record current as implementation proceeds. It is intentionally a roadmap with gates, not a rigid ticket list: fix discovered defects immediately, add required tasks when evidence demands them, and record why the sequence changed.

---

## 1. Mission and non-negotiable outcomes

Build one dependable, serializable Coenx Video composition system that can be authored by people and AI agents, validated before execution, rendered consistently through static MP4 and interactive playback, and extended without creating incompatible parallel formats.

The end state must provide:

1. A reliable 2D/vector scene model with reusable geometry, clipping, masks, gradients, filters and composable effects.
2. Consistent visual semantics across static SVG export, the Rust/Cairo native frame renderer, browser Canvas playback and browser SVG playback. Any backend-specific limitation must be explicit, inspectable and handled through a deliberate fallback or a useful validation error. Silent feature loss is forbidden.
3. An authoring language that exposes supported features without requiring the AI to hand-write low-level JSON or guess parser behavior.
4. First-class AI access through canonical DiveeOI tools, stable schema/definitions, inspectable capabilities, validation feedback, preview/export operations, and maintained skills. Documentation alone is not sufficient.
5. A future 3D renderer with a GPU-accelerated path and a CPU fallback, sharing one 3D scene contract. Projects must remain renderable when a GPU is unavailable, unsupported, blocked by a headless environment, or lost at runtime.
6. Bounded resource use, deterministic export where practical, safe local-asset handling, good errors, and tests that exercise real rendered output rather than only type-level behavior.

### Non-goals for the current execution lane

- Do not replace the current 2D/vector rendering pipeline with a 3D engine.
- Do not start the complete Three.js/R3F, glTF, PBR and skeletal-animation project before the shared 2D renderer semantics and authoring surface are stable.
- Do not make a GPU mandatory for video generation or CI.
- Do not introduce a second AI-facing tool registry or a second composition schema.
- Do not silently approximate unsupported effects in one renderer while claiming parity.

---

## 2. Current baseline (verified or known on 2026-11-21)

### Composition and authoring

- Composition schema version 1 is serializable JSON data with scenes, visual nodes, animation keyframes, interaction ASTs, audio, local assets, learning provenance, 2D/3D physics and scene transitions.
- The CML/CSS/JS-like source compiler exists. The JS-like file is a restricted declarative module, not executable JavaScript. Unsafe markup, CSS and script constructs are rejected.
- Rectangles, ellipses, paths, lines, text, images, buttons, inputs, selects and mesh3d nodes are represented in the shared model.
- Linear/radial gradients and quadratic/cubic vector paths were added to the shared model and existing renderers. The gradient and path model is not yet fully available from CML authoring.
- Path geometry currently lives on individual PathNode values; a reusable scene-level path/clip resource graph is not implemented.
- There is no complete clipping, masking, or general filter/effect model yet.

### Rendering

- Static SVG/ImageMagick export is the broad compatibility path. ImageMagick is used for image conversion/rasterization tasks, not as the owner of frame composition.
- The opt-in Rust/Cairo renderer composes native frames and streams them to FFmpeg for standard MP4 output.
- Interactive output has browser Canvas and SVG renderers, along with DOM controls and the interactive event/state runtime.
- The current 3D path is a CPU/software-projected triangle renderer with camera projection, lighting/material controls, morph targets, animation and deterministic physics. It is useful but is not a full scene graph or a proper GPU renderer.
- Three.js, R3F, glTF, skeletal animation, GPU shadow mapping and full PBR are not implemented. Keep these deferred until the 2D authoring and backend contracts are sound.

### AI integration

- Coenx Video has project-local skills under `.agents/skills/coenx-video*/` and bundled skill copies in `packages/db/src/plugin/skill/bundled/coenx-video*/`.
- The main skill describes the package workflow and CLI. Skills cover language, validation, motion, accessibility, fonts, learning, physics and related authoring topics.
- DiveeOI's canonical AI tool architecture is in `packages/db/src/tool/`: `Tool.make`, `Tools.Service.register`, typed schemas and the existing tool registry. New video tools must use this architecture.
- There is not yet a dedicated, typed Coenx Video tool surface for capability discovery, composition inspection, validation, preview and export. Do not treat shell/CLI access as a sufficient long-term AI interface.

### Verification baseline

The preceding implementation reported a passing Coenx Video TypeScript suite (55 tests, 218 assertions), typecheck, Oxlint and Prettier checks, plus 8 passing Rust tests, rustfmt, Clippy with warnings denied and an offline release build. Re-run the relevant checks after any changes; these historical results are a starting point, not a substitute for current verification.

---

## 3. Architecture rules

### 3.1 One composition model, explicit output backends

The composition model and validated scene data are the contract. Renderers consume that contract; they do not invent their own feature semantics.

Maintain separate but coordinated backend adapters:

- **Static SVG backend:** full SVG semantics for the supported feature subset, then the existing raster/FFmpeg pipeline.
- **Native frame backend:** Rust/Cairo owns repeated frame composition and feeds FFmpeg. It must support a feature before that feature is advertised as native-compatible.
- **Interactive Canvas backend:** browser Canvas implementation for responsive playback.
- **Interactive SVG backend:** semantic SVG implementation for vector fidelity and accessibility where possible.
- **3D backends (deferred):** a browser GPU backend and a native GPU backend behind a shared 3D renderer interface, with the existing software CPU renderer retained as fallback.

A renderer capability registry must describe support by backend, output mode and feature. Validation and tool results should be able to answer whether a requested composition can run on a selected backend and what will happen otherwise.

### 3.2 Deterministic, bounded processing

- Keep frame rendering addressable by exact frame number. Do not make export depend on real-time browser timers.
- Bound dimensions, frame count, nodes, path commands, filter radius, mask complexity, image size, memory and concurrent renders.
- Reuse decoded assets and compiled path data where safe; bound caches and invalidate them by stable content identity.
- Check cancellation between frame batches and before expensive asset/filter operations.
- Avoid unbounded per-frame allocations and avoid repeatedly decoding the same assets.
- Preserve the existing local project-root asset boundary. No implicit remote downloads, path traversal, untrusted external references, or executable project content.
- Keep Rust for measured hot loops and native frame composition; keep TypeScript for authoring, validation, orchestration, browser interactions and capability selection.

### 3.3 Compatibility and fallback policy

- Every new visual feature must have a support row in the capability registry and a test for every backend that claims support.
- A renderer may implement a documented, visually acceptable approximation only when the model marks it as such and validation/tool output reports it. It must never quietly drop a clip, mask, filter, animation or material.
- If the requested backend cannot satisfy the required feature set, choose a compatible backend when automatic selection is enabled; otherwise fail validation with feature IDs and a suggested backend.
- The output manifest and AI tool result must record the backend actually used and any fallback or approximation.
- CPU fallback is a supported execution mode, not an exceptional failure mode.

### 3.4 AI-facing contract

A feature is not complete until all of the following are updated:

1. Shared model types and strict runtime validation.
2. Public package exports and authoring/compiler support, where appropriate.
3. Renderer implementations and capability metadata.
4. Tests that prove accepted inputs work and invalid inputs fail safely.
5. Machine-readable schema/reference information.
6. Relevant skill instructions, examples and bundled copies.
7. AI tool input/output definitions and useful failure messages, whenever the feature is relevant to tool operations.

The AI should discover capabilities from code-backed metadata, not from duplicated hand-maintained claims. Skill prose explains good authoring choices; tools validate and execute them.

---

## 4. Execution order and work packages

Status vocabulary: `DONE`, `ACTIVE`, `NEXT`, `BLOCKED`, `DEFERRED`, `NOT STARTED`.

### Work package 0 - Preserve baseline and maintain this roadmap

**Status: ACTIVE / this plan created**

- [x] Establish the durable plan location and execution rules.
- [ ] Record the exact working-tree baseline before the next implementation batch.
- [ ] Identify the actual package scripts and test entry points before each large refactor.
- [ ] Keep all pre-existing modifications and untracked work intact. Do not reset, clean, stage, commit or deploy unless explicitly requested.
- [ ] Update this plan after each meaningful milestone: completed work, tests, remaining failures and the next exact task.

**Exit gate:** the plan contains a truthful baseline, current active work package, and a concrete next action.

### Work package 1 - Shared path resources and clipping semantics

**Status: IMPLEMENTED / 2026-11-21 (parity maintenance remains ongoing)**

This first renderer feature milestone is implemented. Reusable paths and node-local clipping now render through static SVG, interactive SVG, Canvas and native Cairo/MP4. Keep the remaining broader transform/image/text visual fixtures as follow-up hardening, but WP2 is now the next feature milestone. Build on the existing PathNode and path serializer; do not create an unrelated drawing subsystem.

#### Model and semantics

- [x] Design a scene-level reusable path definition with a stable validated ID, explicit source/view-box dimensions and bounded path commands.
- [x] Allow a PathNode to use either inline commands (backwards compatible) or a path reference. Validation rejects missing references, duplicate resource IDs, ambiguous inline-plus-reference input, invalid view boxes and malformed commands.
- [x] Add named clip-path definitions that reference reusable path resources.
- [x] Add an optional clip-path reference to visual nodes. The coordinate rule is node-local; the resource view box scales to the node box and the node's existing transform/opacity remains authoritative.
- [x] Keep the resource graph acyclic by making clip resources refer directly to path definitions only; no recursive resource graph is supported.
- [x] Define fill-rule behavior (`nonzero` and `evenodd`) across supported renderers.

#### Backend support

- [x] Static SVG: emit generated `defs/path/clipPath` resources and attach `clip-path` to the correct node grouping. Definitions are currently emitted per referencing node rather than deduplicated across nodes; deduplication is a small follow-up optimization.
- [x] Interactive SVG: emit stable scene/node resource IDs and preserve clipping during node rendering; browser tests cover the emitted clip references.
- [x] Canvas: apply clipping under the node transform and support both fill rules; browser pixel tests cover inside/outside and an even-odd hole.
- [x] Rust/Cairo: implement a bounded native clip operation with node-level isolation and fill rules; native pixel tests cover an even-odd hole.
- [x] Native video: resolve TypeScript path resources before the Rust frame call and render clips directly; an MP4 integration test proves the result is encoded.
- [ ] Confirm clipping interacts correctly with images, text, paths, opacity, rotation, scale, transitions, hidden nodes and z-order.

#### Tests and exit gate

- [x] Unit tests for valid/invalid resources, missing/duplicate references, coordinate scaling and fill rules; a total path-command budget is validated before rendering.
- [ ] Expand cross-backend fixtures to cover image crop, text reveal, nested/overlapping transforms, hidden nodes and transition interaction. Current coverage includes reusable vector clips, even-odd holes and native/static MP4 output.
- [x] Browser tests for Canvas/SVG; static SVG/FFmpeg MP4; Cairo raster pixel test; native FFmpeg MP4 smoke test.
- [x] Test invalid/missing/duplicate/over-budget resources before heavy rendering. Nested reference cycles are impossible in the current direct-reference model.
- [x] Update the core, language, validation and rendering skills plus the docs with the new model and tool workflow.

**Exit gate:** the same clip fixture renders visibly and correctly in every backend that claims support; unsupported paths are reported and routed or rejected rather than silently misrendered.

### Work package 2 - Reusable masks and compositing

**Status: NEXT / P0 for the next renderer feature slice**

- [ ] Define reusable mask resources with explicit alpha or luminance semantics, coordinate system, bounds and references.
- [ ] Support node-level mask application and define whether mask content is independent of the masked node's transform or inherits it.
- [ ] Implement isolated offscreen/group compositing for Canvas and native rendering. Avoid allocating a full-stage surface per node when a bounded mask region is sufficient.
- [ ] Implement equivalent SVG mask resources with explicit `maskUnits` and `maskContentUnits`.
- [ ] Define predictable behavior for transparent pixels, opacity, antialiasing, text, gradients and clipping inside masks.
- [ ] Bound mask dimensions, nesting depth, total temporary surface memory and per-frame work.
- [ ] Do not claim luminance-mask support on a backend until colors are converted to luminance correctly.
- [ ] Add native and browser pixel fixtures, overlap/transform tests, memory-limit tests and export smoke tests.
- [ ] Add mask syntax and examples to CML plus validation messages and AI skill/reference updates.

**Exit gate:** alpha masks are consistent across the supported renderers; luminance masks are separately capability-gated if a backend cannot provide parity.

### Work package 3 - Paint model and richer gradients

**Priority: P1**

Linear and radial gradients already exist. Extend them without breaking current solid-color or gradient JSON.

- [ ] Review current gradient coordinate semantics, stop ordering, opacity and per-node mapping. Freeze them in tests before extension.
- [ ] Add explicit spread behavior (`pad`, `repeat`, `reflect`) with a safe default matching today's output.
- [ ] Add gradient transforms and define whether gradient coordinates are local to the node or to the scene.
- [ ] Consider conic gradients only after all current backends have a clear support/fallback strategy.
- [ ] Define reusable paint resources so multiple nodes can reference one gradient without copy/paste.
- [ ] Add CML authoring syntax, parser errors and stable serialization.
- [ ] Make Canvas, SVG and Cairo behavior match. When Cairo cannot match an advanced mode exactly, report the capability gap and select a compatible renderer.
- [ ] Add visual regression fixtures for stop alpha, transform, repeated/reflected edges, very small nodes and high-DPI playback.

**Exit gate:** existing gradients remain pixel/behavior compatible; new modes have cross-backend evidence and machine-readable capability entries.

### Work package 4 - A bounded filter/effect graph

**Priority: P1 / after clipping and compositing**

Do not add a generic arbitrary shader or unrestricted filter language. Begin with an intentionally small declarative effect set.

- [ ] Define a versioned effect type list: start with Gaussian blur, drop shadow and color adjustment; add displacement or custom shader effects only after a separate safety/performance review.
- [ ] Define ordered effect composition, input/output bounds, local-space behavior and alpha handling.
- [ ] Set hard maximum blur radius, shadow spread/offset, filter-chain depth, pixel count and temporary memory.
- [ ] Establish effect behavior for text, images, gradients, paths, masks and nested transforms.
- [ ] SVG backend: use generated, scoped `filter` definitions; never import caller-provided raw SVG filters.
- [ ] Canvas backend: use native Canvas filters where supported, otherwise bounded offscreen operations; feature-detect rather than assume.
- [ ] Cairo backend: implement supported filters through bounded image surfaces or choose an explicit SVG fallback. Do not approximate a heavy blur with an undocumented visual shortcut.
- [ ] Add cache keys that include source frame/content, effect parameters, scale and renderer; cap memory and expose cache metrics.
- [ ] Add tests for visual output, edge clipping, filter region growth, transparent pixels, cancellation and resource limits.
- [ ] Expose all accepted effects through CML and AI definitions/skills, with capability-aware authoring advice.

**Exit gate:** no effect can allocate unbounded surfaces or silently disappear; the tool capability response can name the chosen backend and any fallback.

### Work package 5 - Complete the authoring language surface

**Priority: P0 transversal gate / deliver alongside WPs 1-4**

CML must expose the actual shared renderer, not a stale subset.

- [ ] Extend the language reference and parser for reusable path definitions, path references, clip paths, masks, gradient definitions/references and the accepted effect model.
- [ ] Preserve version 1 compatibility for existing projects. Introduce a schema version change only if a semantic change cannot be represented as an additive optional field.
- [ ] Define concise syntax with stable IDs and predictable local coordinate semantics. Do not make AI authors hand-encode serialized JSON in attributes.
- [ ] Keep CSS support bounded. Do not smuggle unsupported SVG filter strings through project CSS.
- [ ] Validate all IDs, references, numeric bounds, element nesting, resource counts and supported attributes before producing a composition.
- [ ] Ensure compile errors include file/source location, element ID and a repair hint suitable for an AI tool response.
- [ ] Add parser/compiler round-trip fixtures for every feature and retain existing sample project compatibility.
- [ ] Update `.agents/skills/coenx-video-language/references` and the bundled equivalent, plus the core and validation skills.

**Exit gate:** every feature marked authorable in the capability registry can be represented in CML, compiled, validated and previewed.

### Work package 6 - First-class AI tools, definitions and skills

**Priority: P0 transversal gate / build incrementally, not as a final documentation chore**

Implement through `packages/db/src/tool/` and the canonical DiveeOI tool model only.

#### Code-backed capability source

- [x] Create a public code-backed capability registry under `@diveeoi/coenx-video/capabilities` describing features, backends, output modes, support and limitations.
- [x] Include current CPU 3D capability separately from future GPU 3D; GPU status is explicitly `planned`, never available.
- [x] Export the stable machine-readable response shape and types. The tool and skills use this source; generic generated-doc parity still remains.

#### Canonical AI tool definitions

- [x] `coenx_video_capabilities`: registered through the canonical tool layer; reports renderer support, CPU/GPU 3D truth, authoring gaps and limitations.
- [x] `coenx_video_validate`: registered through the canonical tool layer; accepts CML or JSON text, compiles/validates it, enforces a 2 MiB combined-source bound and returns structured diagnostics plus a stage/scene/frame summary without rendering. File/asset resolution is outside this tool.
- [ ] `coenx_video_inspect`: summarize project scenes, node/resource IDs, timing, asset references, provenance and backend requirements.
- [ ] `coenx_video_preview`: render a bounded list of requested frames or scene thumbnails at a low-cost profile and return usable file/image outputs plus backend/fallback metadata.
- [ ] `coenx_video_export`: export standard MP4 or an interactive project with a bounded profile, cancellation/progress, safe output paths and a structured final manifest.
- [ ] `coenx_video_reference`: provide the relevant authoring/schema reference section and feature examples without flooding every prompt with the entire manual.
- [x] Use `Tool.make`, typed Effect Schema input/output, and `Tools.Service.register`; register from `BuiltInTools.locationLayer` and verify the tools appear in the model-visible registry. These initial tools are read-only CPU operations and do not access project files.
- [x] Keep current capability and validation tools narrow: no arbitrary code, remote media fetching, project-file paths or raw shader execution.
- [x] Return bounded validation diagnostics with stable broad error codes and actionable compiler/validator messages. Add finer path/node/resource identifiers as validation evolves.
- [ ] Add tool tests for future permission-sensitive project-file operations, path confinement, cancellation, successful preview/export and fallback reporting.
- [x] Verify registration through the canonical built-in layer and model-visible definitions; the integration test exercises the real registry.

#### Skills and definitions

- [x] Update the project-local and bundled core Coenx Video skill together; current copies are identical.
- [x] Update language and validation skills with the current structured-model/CML boundary and the tool preflight. Update other focused skills as their feature semantics change.
- [x] Add a dedicated rendering/backend skill with capability checks, current backend limitations and fallback policy.
- [x] Keep the existing 3D skill guidance explicit that current 3D is CPU/software projected; create a separate GPU-specific skill when WP8 begins.
- [x] Put the current public tool names/input/output expectations and validation workflow in the core/rendering/validation skills.
- [ ] Add a whole-catalogue sync/parity test or deterministic generation step; currently the rendering skill has a dedicated byte-equality test and four pairs were manually checked.
- [x] Update docs/skills.md, docs/coenx-video.md and the package README.

**Exit gate:** a model can discover supported features, author a project, validate it, request preview frames, repair failures and export using typed tools without relying on shell command construction. Tool definitions and skills describe the same implementation state.

### Work package 7 - Renderer architecture, observability and quality gates

**Priority: P1 / continuous**

- [ ] Add a renderer selection layer that takes required features, output target, runtime capabilities and user preference, and returns a concrete backend plan with reason codes.
- [ ] Add per-render telemetry: selected backend, requested/used features, fallback reason, timings by stage, frame throughput, asset decode/cache metrics and peak/temporary memory where measurable.
- [ ] Keep logs structured and do not write diagnostics into native JSONL stdout.
- [ ] Add test fixtures shared across renderers and classify each as exact parity, tolerance-based parity or explicitly renderer-specific.
- [ ] Use headless browser tests for Canvas/SVG; native Rust unit/raster tests; MP4 smoke tests with ffprobe; and selected visual snapshots.
- [ ] Add low-memory/low-resolution test profiles suitable for the user's hardware and CI.
- [ ] Check cancellation, malformed inputs, path confinement, large assets, invalid references and denial-of-service bounds.
- [ ] Track performance baselines and avoid optimizing by guesswork. Benchmark representative scenes before introducing parallel frame rendering or GPU readback complexity.

**Exit gate:** backend choice and failure behavior are inspectable, reproducible and covered by a repeatable verification matrix.

### Work package 8 - Proper GPU-accelerated 3D backend with CPU fallback

**Priority: DEFERRED / do not begin full implementation until WPs 1-7 are stable**

This is a real future milestone, not a forgotten note. Keep the current CPU 3D renderer working throughout.

#### Shared 3D contract and backend interface

- [ ] Audit and evolve the existing mesh3d/light/camera/material/morph/physics model into a coherent scene graph with parent transforms, reusable geometry/materials, camera, lights and asset references.
- [ ] Preserve current mesh3d JSON compatibility through a migration/normalization adapter.
- [ ] Define a backend-neutral API for capability probing, resource upload, frame rendering, readback/presentation, disposal and context/device loss.
- [ ] Keep deterministic CPU evaluation for animation and physics independent from GPU execution. The GPU backend should consume evaluated poses, not own the authoritative timeline.
- [ ] Define a renderer policy: GPU when available and compatible; CPU fallback when absent, disabled, unsupported, headless, out of memory or lost. Provide a force-CPU option for tests and debugging.

#### Interactive GPU renderer

- [ ] Implement a Three.js-based browser renderer using WebGL2 as the broadly supported GPU path; evaluate WebGPU as an optional capability rather than a hard requirement.
- [ ] Do not force React Three Fiber into the current SolidJS/browser runtime. Keep the renderer framework-neutral; provide an R3F adapter only if a real React host later requires one.
- [ ] Add explicit device/context lifecycle handling, resize behavior, DPR/frame-rate limits, disposal and fallback on WebGL/context loss.
- [ ] Keep Canvas/SVG 2D composition functioning; define how 2D overlays and 3D viewport layers share scene ordering, clipping and transitions.

#### Native GPU renderer

- [ ] Evaluate Rust `wgpu` for native frame rendering and maintain the current CPU software renderer as a fallback.
- [ ] Probe available Vulkan/Metal/DX12/GL adapters, limits and device availability. Do not assume a discrete GPU or physical display exists.
- [ ] Render to bounded offscreen targets, read back frames safely and stream them into the existing FFmpeg pipeline.
- [ ] Handle systems with software adapters, no adapter, headless rendering and GPU device loss deterministically.
- [ ] Do not make FFmpeg depend on GPU encoding; hardware video encoding may be an optional, separately detected output optimization.

#### 3D capability milestones

- [ ] glTF 2.0 loading for local assets with strict file-size, texture-size, animation-count and path-sandbox limits.
- [ ] Hierarchical transforms, instancing and reusable mesh/material resources.
- [ ] Skinning and skeletal animation with validated bone/weight bounds.
- [ ] Morph targets and frame-keyed animation parity with the existing timeline.
- [ ] Metallic-roughness PBR materials, normal/roughness/metalness/emissive maps, tone mapping and color-space management.
- [ ] Directional/spot/point lights, shadow maps with explicit quality budgets, environment lighting and optional HDR image-based lighting.
- [ ] Culling, LOD, instancing, geometry/texture caches and profiling.
- [ ] GPU/CPU output comparison fixtures; exact match is not assumed for rasterization, but differences must be measured and bounded.
- [ ] Update the capability tool, schema, language, 3D/rendering skills and examples for every delivered 3D feature.

**Exit gate:** the same validated 3D composition renders interactively and to MP4 using GPU where available and CPU otherwise, with clear capability/fallback reporting and no 3D-only format fork.

---

## 5. Required verification matrix

Use the smallest relevant suite during iteration, then run the complete package checks for each milestone.

| Layer           | Required verification                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Shared model    | typecheck, schema validation tests, malformed-reference and resource-limit tests                                     |
| CML             | parser/compiler tests, source-location diagnostics, compatibility fixtures and round-trip tests                      |
| Canvas          | headless browser rendering, interaction tests, pixel/geometry assertions and hidden-tab/resume behavior              |
| Interactive SVG | headless browser rendering, defs/reference assertions, transitions and state updates                                 |
| Static SVG      | output structure tests, generated SVG opened/rasterized by the supported raster path                                 |
| Native Rust     | `cargo fmt --check`, `cargo test --offline`, `cargo clippy --offline -- -D warnings`, release build                  |
| Native MP4      | real output, ffprobe stream/duration/frame checks and selected frame inspection                                      |
| AI tools        | canonical registration, generated model definitions, schema rejection, permission/path tests, preview/export outputs |
| Skills          | project-local/bundled content parity and tool-name/reference validity                                                |
| GPU 3D (future) | GPU-present test, forced CPU test, no-adapter test, headless test, context/device-loss test and measured parity      |

Never call a test passed unless it was run on the current source after the latest relevant edit. Record environmental limitations separately from product failures.

---

## 6. Decision log

| ID    | Decision                                                                                                           | Reason / constraint                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| D-001 | One serializable composition model is authoritative.                                                               | Prevents standard and interactive projects drifting into separate formats.                 |
| D-002 | SVG, Canvas and native renderers consume the same validated feature model.                                         | Enables parity tests and deliberate backend selection.                                     |
| D-003 | Keep current CPU 3D renderer as a supported fallback.                                                              | The GPU path must not make export or CI depend on hardware.                                |
| D-004 | Defer full Three.js/R3F, glTF, PBR and skeletal animation until 2D renderer semantics and AI authoring are stable. | This is the user's requested priority order; it reduces parallel architecture churn.       |
| D-005 | Use canonical DiveeOI `Tool.make` and `Tools.Service.register` for video tools.                                    | Existing architecture requires one tool representation and one permission/settlement path. |
| D-006 | Capability metadata is code-backed and returned by tools.                                                          | Prevents skill prose from advertising unsupported renderer features.                       |
| D-007 | No silent feature loss.                                                                                            | A fallback or validation error is preferable to a plausible but incorrect render.          |

Change these decisions only when implementation evidence justifies it. Add a new decision entry with date, reason, and migration impact instead of silently changing the architecture.

---

## 7. Issue and deviation register

Use stable issue IDs. Add an entry whenever implementation discovers a cross-renderer mismatch, unsafe input, performance boundary, missing tool registration path or architecture constraint that changes the plan.

| ID    | Status   | Finding                                                                                                                                         | Resolution / plan impact                                              |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| I-001 | OPEN     | Masks/compositing and the general effect graph are still not represented by shared bounded resources. Reusable paths and clips are implemented. | WP2/WP4; begin with alpha masks and explicit coordinate/budget rules. |
| I-002 | OPEN     | CML does not yet expose all shared-model path and gradient features.                                                                            | Address in WP5 alongside each model feature.                          |
| I-003 | OPEN     | Capability/validation tools are registered, but inspect/preview/export/reference tools and renderer planning are not.                           | Continue WP6 incrementally using the existing DB tool architecture.   |
| I-004 | DEFERRED | Full GPU 3D renderer, glTF, skeletal animation, PBR and shadow mapping are not implemented.                                                     | Retain as WP8; current CPU renderer remains usable.                   |

When an issue is fixed, change its status to `RESOLVED` and record the verification evidence. Do not delete resolved entries; their history helps future sessions avoid rediscovering old failures.

---

## 8. Session handoff protocol

At the start of every continuation:

1. Read this file first, then `packages/coenx-video/AGENTS.md`, relevant project instructions, and the current implementation files for the active work package.
2. Inspect Git status and preserve all modified/untracked work. The workspace may contain concurrent project changes; never infer that an untracked directory is disposable.
3. Verify the active work package and next action below. Do not jump to WP8 because it is more exciting.
4. Implement one coherent vertical slice. Add tests and update public exports, CML, capabilities, AI tools and skills as the feature requires.
5. Run targeted tests, then the required package/native checks. Fix regressions before expanding scope.
6. Update the progress ledger, issue register and next action in this file. Include exact files and commands/results. Do not mark a task complete based only on code being written.

### Flexibility rule

If a discovered defect blocks the active work, fix it before continuing. If a new architectural requirement appears, add a task or issue with evidence and adjust ordering. The roadmap is allowed to evolve; the mission, single-model constraint, AI-access requirement, fallback guarantee and explicit capability reporting are not optional.

---

## 9. Progress ledger

### 2026-11-21 - Roadmap established

- Created this living implementation plan.
- Confirmed the current Coenx Video architecture: shared composition model; SVG/ImageMagick standard path; Rust/Cairo native frame path; Canvas/SVG interactive paths; restricted CML compiler; software CPU mesh3d renderer.
- Confirmed the existing AI tool registration contract in `packages/db/src/tool/`: canonical `Tool.make` definitions registered through `Tools.Service.register`.
- Confirmed project-local and bundled Coenx Video skill trees exist.
- Preserved the existing dirty workspace. No reset, clean, stage, commit, deployment or service changes were performed.

### 2026-11-21 - Reusable paths, clipping and AI capability/validation integration

- Implemented scene-level `PathDefinition` and `ClipPathDefinition` resources; added `PathNode.pathRef` and `NodeBase.clipPathId` while preserving inline path compatibility.
- Added strict resource/reference/coordinate/fill-rule/path-command validation, including a 16,384 total path-command budget per scene.
- Integrated shared path and clip geometry through static SVG, interactive SVG, Canvas and Rust/Cairo native rendering.
- Added actual browser Canvas pixel assertions, SVG clip definition checks, a Cairo even-odd hole pixel test, static MP4 clip export and native MP4 clip export.
- Added `src/capabilities.ts` as the code-backed renderer/authoring/3D capability matrix and a server-safe `src/validation.ts` entry point.
- Registered `coenx_video_capabilities` and `coenx_video_validate` through `packages/db/src/tool/builtins.ts` using the canonical `Tool.make` / `Tools.Service.register` architecture.
- Added `coenx-video-rendering` in both project-local and bundled skills; updated core, language and validation skill guidance and the docs.
- Added DB tool integration and rendering-skill parity tests. Current tests: Coenx package 62/62 (243 assertions); DB Coenx tool 7/7 (11 assertions); Rust 9/9. Coenx typecheck/lint, DB typecheck/targeted lint, rustfmt, Clippy with warnings denied and offline release build passed.
- Created the detailed continuation handoff at `docs/handoffs/coenx-video-renderer-handoff-2026-11-21.md`.
- Preserved the broad dirty workspace; no reset, clean, stage, commit, push or deploy was performed.

### Current execution pointer

**Active work package:** WP2 - Reusable masks and compositing.  
**Next concrete action:** design the additive alpha-mask resource and node reference semantics, including node-local coordinate mapping, opacity/alpha composition rules, maximum mask count/size/nesting and temporary-surface memory budgets. Write schema/validation tests first. Then implement the bounded SVG, Canvas and Cairo paths, add pixel/MP4 coverage, update the capability matrix and canonical AI guidance. Keep luminance masks separately capability-gated until true luminance conversion is implemented.

**Parallel AI tooling track:** WP6 is active but partial. Capability and validation tools are complete; inspect/preview/export/reference tools remain. Do not block WP2 on implementing all of those, but maintain the canonical tool/skill surface as each renderer feature is delivered.

**GPU 3D:** remain deferred under WP8.
