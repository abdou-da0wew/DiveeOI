# Coenx Video Renderer - Engineering Handoff

**Handoff date:** 2026-11-21  
**Repository:** `/home/ababado/DiveeOI-ai-learning-update`  
**Branch at handoff:** `dev`  
**Primary package:** `packages/coenx-video`  
**Application integration:** `packages/db`  
**Long-term roadmap:** `docs/plans/coenx-video-renderer-roadmap.md`  
**Status:** WP1 (reusable vector paths and clipping) implemented and verified; AI capability/validation tools integrated; WP2 (masks/compositing) is the next renderer milestone. Full GPU 3D remains deliberately deferred.

This document is the continuation handoff for the next AI engineering agent. Read it before changing code. It records what was actually implemented and tested, what remains incomplete, how the AI tools and skills are wired, and exactly where to continue. The roadmap is the long-term source of truth; this handoff is the detailed snapshot of the current implementation.

---

## 1. Mission and priority order

Continue making Coenx Video a dependable shared composition and renderer system for both regular MP4 generation and interactive browser output.

The project must preserve one validated, serializable composition model, with rendering backends consuming that model. Every supported capability should be usable and discoverable by the AI through real typed tools, machine-readable schemas/definitions and maintained skills. Tooling and skill updates are part of feature completion, not optional documentation cleanup.

The requested priority order is:

1. Improve the current shared 2D/vector composition model and renderer semantics.
2. Complete cross-renderer parity and resource safety: reusable geometry, clips, masks, compositing and effects.
3. Expose model features through the supported CML/source authoring format where appropriate.
4. Make the capabilities, validation, inspection, preview and export workflow available as canonical DiveeOI AI tools.
5. Make matching project-local and bundled skills explain the real, tested capabilities.
6. Add renderer selection, fallback reporting, telemetry and repeatable benchmarks.
7. Only after those foundations stabilize, begin the complete GPU-accelerated 3D backend while preserving CPU fallback.

**Do not jump straight to GPU 3D.** The full Three.js/WebGL2 and native Rust/wgpu work is explicitly recorded as WP8 in the roadmap. It must not displace the current renderer priorities.

---

## 2. Workspace safety and operating constraints

### Repository and state

- Work in `/home/ababado/DiveeOI-ai-learning-update`, branch `dev`.
- The repository was already heavily modified and contains many untracked files from earlier work. The active Coenx package itself is largely an untracked directory, not a clean tracked package.
- The current workspace also contains unrelated modified files and staged additions in other scopes, including root guidance/context files, package metadata, skill resources, research material, `.gitmodules`, and `third_party/motion-graphics`.
- The Git status was intentionally inspected and preserved. It is not a clean-room checkout.

### Non-negotiable preservation rules

1. **Do not run** `git reset`, `git clean`, `git checkout --`, `git restore`, or any broad revert command.
2. Do not delete untracked files or directories just because Git shows them as untracked.
3. Do not stage, commit, push, deploy, restart services or change running deployments unless the user explicitly requests that operation.
4. Do not run root-level formatters or bulk rewrites across unrelated packages.
5. Before every substantial batch, inspect `git status --short` and only modify files relevant to the active task.
6. Do not assume an existing untracked artifact is disposable. Preserve the earlier Coenx source, skills, vendored assets and research archive.
7. Use the repository's existing package scripts and Bun workspace. The working machine has Bun at `$HOME/.bun/bin/bun`; prepend that to PATH when the shell does not already see it.
8. No background work. Complete and verify work in the current session.

Useful first commands:

```sh
cd /home/ababado/DiveeOI-ai-learning-update
git branch --show-current
git status --short --untracked-files=all
export PATH="$HOME/.bun/bin:$PATH"
```

Read `AGENTS.md`, `packages/coenx-video/AGENTS.md`, `packages/db/src/tool/AGENTS.md`, and the roadmap before implementation.

---

## 3. Current system architecture

### Shared data model

The authoritative schema is under `packages/coenx-video/src/model/`. The composition is JSON-compatible and contains a stage, ordered scenes, visual nodes, timeline/animation data, interaction AST, audio, assets and optional learning provenance/physics data.

The same validated model feeds these output paths:

| Backend                            | Purpose                        | Current execution               |
| ---------------------------------- | ------------------------------ | ------------------------------- |
| Static SVG -> rasterizer -> FFmpeg | Default/compatibility MP4 path | SVG/ImageMagick/FFmpeg          |
| Native frame renderer -> FFmpeg    | Opt-in native MP4 path         | Rust + Cairo/Pango, then FFmpeg |
| Interactive Canvas                 | Browser interactive player     | Canvas 2D                       |
| Interactive SVG                    | Browser interactive player     | SVG DOM                         |

Do not invent another scene/composition schema for one backend. A backend-specific implementation may normalize the common model before rasterization, but the shared model remains authoritative.

### Standard MP4

- `packages/coenx-video/src/render/scene-svg.ts` constructs per-frame SVG.
- The rasterization pipeline uses ImageMagick for raster work/conversion and FFmpeg for video encoding.
- ImageMagick is not the owner of per-frame scene composition.
- The portable Linux binary is currently at `packages/coenx-video/vendor/imagemagick/linux-x64/bin/magick` (approximately 41 MiB).
- FFmpeg and ffprobe are system executables in the test environment.

### Native MP4

- `packages/coenx-video/src/render/native.ts` evaluates scene nodes, resolves assets and normalizes the model into the JSONL protocol expected by Rust.
- Native adapter resolves reusable TypeScript path/clip references before sending a frame to Rust.
- Rust source is under `packages/coenx-video/native/coenx-video-native/src/`.
- `render.rs` dispatches frame node types; `render/path.rs` owns Cairo path drawing and clip application.
- Cairo owns native frame composition; FFmpeg encodes the output.
- Release binary currently exists at `packages/coenx-video/native/coenx-video-native/target/release/coenx-video-native` (approximately 593 KiB). Rebuild it after Rust changes; do not assume it is current after editing source.

### Interactive playback

- `packages/coenx-video/src/runtime/canvas-renderer.ts`: Canvas rendering.
- `packages/coenx-video/src/runtime/svg-renderer.ts`: SVG DOM rendering.
- `packages/coenx-video/src/runtime/svg-primitives.ts`: shared SVG primitives, text and gradient construction (split out to keep the renderer module bounded).
- The existing runtime owns playback timeline, state, event dispatch, accessible HTML controls, audio and scene transitions.

### CML/source compiler

- `packages/coenx-video/src/format/compiler.ts` and adjacent parser modules compile a deliberately restricted CML/CSS/JS-like source format into the shared data model.
- The JS-like file is a declarative data module parsed into a validated interaction/action AST. It is not executable JavaScript.
- Do not use `eval`, `Function`, dynamic imports, arbitrary callbacks, arbitrary CSS, unrestricted SVG strings or remote media fetching.
- CML v1 still exposes only its current bounded node/style subset. Reusable paths/clips and gradient-paint literals are **not yet CML features**.

### 3D status

Current 3D is CPU/software projection of mesh geometry. It currently includes perspective projection, lighting/material response, morph targets, frame-keyed transform animation and deterministic 3D physics. It works in the current SVG and native render paths.

It is **not** a GPU 3D renderer and is not a full 3D engine. Three.js, WebGL2/WebGPU, native wgpu, glTF, skinning/skeletal animation, shadow maps and full PBR are future work.

---

## 4. Work completed in the current implementation slice

### 4.1 Reusable path resource model

Files:

- `packages/coenx-video/src/model/types.ts`
- `packages/coenx-video/src/render/path.ts`
- `packages/coenx-video/src/model/validate-paths.ts`

Added:

- `PathFillRule = "nonzero" | "evenodd"`
- `PathDefinition`: stable `id`, explicit `width` and `height` view-box size, path `commands`, optional `fillRule`.
- `ClipPathDefinition`: stable `id`, reference to a reusable `pathId`, optional `fillRule`.
- `Scene.pathDefinitions?` and `Scene.clipPaths?`.
- `NodeBase.clipPathId?`.
- `PathNode.commands?` and `PathNode.pathRef?`. Exactly one is required by validation. The old inline `commands` representation remains supported, so existing projects remain backwards compatible.

Path commands still use the existing shared `moveTo`, `lineTo`, `quadraticTo`, `cubicTo`, and `close` union. Do not create another path command format.

### 4.2 Coordinate semantics

The current implementation uses node-local clip/path geometry:

- A reusable definition has an explicit source view-box width and height.
- When a node refers to it, the coordinates are scaled independently by `node.width / definition.width` and `node.height / definition.height`.
- The resolved commands are expressed in the target node's local width/height coordinate system.
- SVG/Canvas/Cairo then center the node-local path around the node origin, matching the existing inline path renderer.
- The node's existing position, rotation, scaling, opacity and z-order remain responsible for placing/clipping the rendered node.
- A 2D clip path is currently rejected on `mesh3d` nodes. Do not pretend the 2D path system clips projected 3D nodes.

The resolver functions are `resolveNodePath(node, scene)` and `resolveClipPath(node, scene)` in `src/render/path.ts`.

### 4.3 Validation and safety bounds

`src/model/validate-paths.ts` is a focused validation module called by the main composition validator.

It checks:

- Path and clip resource IDs against the existing bounded identifier pattern.
- Duplicate path definition IDs and duplicate clip IDs.
- Valid positive view-box dimensions within the configured maximum.
- 2-256 commands per path; the first command must be `moveTo`.
- Valid finite coordinates bounded to the accepted range.
- Valid curve control/end points and supported command types.
- `nonzero` or `evenodd` fill rules only.
- Path reference existence and clip-to-path reference existence.
- Exactly one of inline path commands or `pathRef` on a PathNode.
- Node references to existing clips.
- No more than 256 definitions or 256 clip resources per scene.
- A per-scene total limit of 16,384 path commands, including inline path nodes.

This is a bounded single-level resource system. It does not currently support nested clip-resource graphs, recursive group resources or mask references.

### 4.4 Backend integrations

**Static SVG**

- `src/render/scene-svg.ts` resolves reusable PathNode geometry.
- Emits a node-scoped `clipPath` definition with `clipPathUnits="userSpaceOnUse"`.
- Attaches the generated clip reference to the node's transformed SVG group.
- Sets `fill-rule` and `clip-rule`.

**Interactive SVG**

- `src/runtime/svg-renderer.ts` uses the shared path resolver.
- Emits a clip definition in SVG defs and applies it to the node group.
- Emits fill-rule for reusable/inline path geometry.
- Stable IDs include scene/node identity to avoid collisions within the rendered stage.

**Interactive Canvas**

- `src/runtime/canvas-renderer.ts` uses `Path2D` built from the common SVG path serializer.
- Applies clipping in the node render context.
- Uses the same fill-rule semantics for path fill and clipping.
- Browser test samples actual rendered pixels inside/outside a clip, including a hole created by even-odd fill behavior.

**Rust/Cairo**

- `src/render/native.ts` resolves paths and clip resources before the JSONL request is sent to Rust. Native does not independently parse the TypeScript scene resource graph.
- Native path records receive resolved `commands`, `fillRule` and `clipPath` data.
- `native/coenx-video-native/src/render/path.rs` constructs bounded Cairo paths, maps quadratic curves to cubic curves, applies even-odd/nonzero rules, and executes clip/fill/stroke paths.
- Cairo state is reset/isolated as part of node rendering. The native test verifies a donut-like even-odd clip hole keeps the underlying background pixel rather than filling the hole.

**Native video adapter**

- A full native MP4 integration test renders a reusable PathNode and a clipped rectangle through TypeScript -> Rust -> Cairo -> FFmpeg.
- The test checks that an MP4 is actually produced and contains an MP4 `ftyp` header.

### 4.5 Additional refactor

- Created `src/runtime/svg-primitives.ts` and moved common SVG element, text and gradient construction out of `svg-renderer.ts`.
- Split reusable-path validation out of the already large `src/model/validate.ts` into `src/model/validate-paths.ts`.
- The main `validate.ts` is still around 511 lines, exceeding the package guide's preferred 300-line limit. It predates this latest split and is a future cleanup candidate. Do not perform an unrelated huge refactor in the middle of WP2; split it by coherent validator responsibility when justified.

### 4.6 Tests added/updated

- `test/path.test.ts`: inline and reusable path serialization, definition scaling, SVG clip output, invalid references, duplicates and total path-command limits.
- `test/interactive-browser.test.ts`: Canvas pixel tests and SVG DOM/defs checks for reusable clipping, alongside existing interaction/gradient/3D checks.
- `test/standard-render.test.ts`: reusable clip output through static SVG/ImageMagick/FFmpeg.
- `test/native-video.test.ts`: reusable clip/path through TypeScript native adapter and actual MP4 output.
- `native/coenx-video-native/src/render/tests.rs`: native Cairo even-odd clip hole pixel test.

The test is deliberately not considered complete merely because schema validation accepts a clip. It is tested through rendered output in all four backends.

---

## 5. AI capabilities and tool integration

This is partially complete but is an important architectural milestone.

### 5.1 Code-backed capability registry

File:

- `packages/coenx-video/src/capabilities.ts`

Exports `COENX_VIDEO_CAPABILITIES` and capability types via the package root and the explicit `@diveeoi/coenx-video/capabilities` subpath.

The matrix currently documents:

- Four current backends: static SVG, native Cairo, interactive Canvas, interactive SVG.
- Output targets and CPU acceleration.
- Renderer feature IDs and per-renderer status.
- Current authoring format differences: CML v1 vs structured JSON/TypeScript.
- Reusable paths and clip paths as supported by all four current renderers.
- Linear/radial gradients as supported by all four current renderers.
- Masks and filter effects as unsupported.
- GPU 3D as unsupported/planned.
- Existing CPU-projected 3D features and limitations.
- A future browser Three.js/WebGL2 (WebGPU optional) path and native Rust/wgpu path.
- Deterministic CPU fallback policy for missing/blocked/lost GPU contexts/devices.

Update this matrix whenever backend support changes. Do not maintain a separate contradictory capability table in an AI skill.

### 5.2 Server-safe package entry

File:

- `packages/coenx-video/src/validation.ts`

The explicit `@diveeoi/coenx-video/validation` package export exposes only:

- `compileCmlProject`
- `RENDER_PROFILES`
- `validateComposition`
- `VideoValidationError`
- the `VideoComposition` type

This exists for a reason. Importing the package root into `packages/db` pulled browser DOM globals/types into a server package whose TS config does not include DOM libs. Do not undo this separation. Server-side AI tools should import `/capabilities` and `/validation`, not the package root, unless they genuinely need a browser-safe runtime-free export.

### 5.3 Canonical DiveeOI tool registration

Files:

- `packages/db/src/tool/coenx-video.ts`
- `packages/db/src/tool/builtins.ts`
- `packages/db/test/tool-coenx-video.test.ts`

Registered with the existing canonical architecture:

- `Tool.make`
- Effect Schema typed input/output
- `Tools.Service.register`
- `BuiltInTools.locationLayer`

The new tool layer is included from `packages/db/src/tool/builtins.ts`, which is already included in the live location layer construction. It is not a parallel registry.

Current model-visible tools:

#### `coenx_video_capabilities`

- Takes an empty input object.
- Returns the current machine-readable capability matrix.
- Description explicitly says GPU 3D is planned, not available.
- Output is checked through a typed schema and exposed as JSON text as well as the tool's structured output.

#### `coenx_video_validate`

Input:

- `format`: `"cml"` or `"json"`.
- `source`: full markup or serialized `VideoComposition`.
- `styles?` and `script?`: optional CML companion sources.

Behavior:

- Combined UTF-8 input is bounded to 2 MiB.
- CML compiles using the real CML compiler.
- JSON is parsed, then passed to the shared composition validator.
- JSON cannot include CML styles/script companion fields.
- Uses the quality validation profile to check composition structure and resource bounds.
- Returns `valid`, structured diagnostics (`code`, severity, bounded message), and when valid a stage/scene/node/frame summary.
- Does not render, resolve media files, download assets or execute JavaScript.
- Diagnostics have stable broad codes such as `source.too_large`, `source.unexpected_files`, `source.invalid_json`, `source.compile_failed` and `composition.invalid`.

The tool does not yet return every renderer-specific requirement in the validation response; the separate capability tool supplies that information. A future renderer planner should connect required composition features to a concrete output backend.

### 5.4 Tool tests

`packages/db/test/tool-coenx-video.test.ts` currently has 7 passing tests:

- rendering skill parity
- canonical tool registration
- capability matrix and GPU/CPU fallback truth
- CML successful compile/validation and summary
- JSON successful validation
- malformed/oversized source diagnostics
- invalid composition and unexpected JSON companion file rejection

### 5.5 AI tools still missing

Do not claim these exist yet:

- `coenx_video_inspect`
- `coenx_video_preview`
- `coenx_video_export`
- `coenx_video_reference`

They are planned in WP6. They must be added to this canonical tool architecture using typed schemas and the existing permission/output handling. Do not create a shortcut shell-execution tool or unrestricted filesystem interface.

The current validate tool does not verify that referenced project files actually exist, decode or inspect media, or render a preview. Keep those as explicit responsibilities for future project-aware tooling.

---

## 6. Skills and documentation

### Added rendering skill

- Project-local: `.agents/skills/coenx-video-rendering/SKILL.md`
- Bundled: `packages/db/src/plugin/skill/bundled/coenx-video-rendering/SKILL.md`
- Bundled import and registration: `packages/db/src/plugin/skill/bundled/coenx-video/index.ts` (`skill19`, skill list count 20)

The skill tells agents to:

1. Call `coenx_video_capabilities` before renderer-specific decisions.
2. Author in the shared composition model.
3. Use CML for its current subset and structured JSON for current path/clip/gradient features.
4. Call `coenx_video_validate` before rendering.
5. Never silently strip unsupported features.
6. Treat masks, filter effects and GPU 3D as not implemented.
7. Avoid promising inspect/preview/export tools until they appear in the live catalogue.

### Existing skills updated

The local and bundled core `coenx-video` skills were updated with tool names, source validation and renderer constraints.

The local and bundled `coenx-video-validation` and `coenx-video-language` skills were also updated:

- Validation skill explains the capability/validation tool preflight.
- Language skill documents paths/clips/gradients in the structured model, not CML v1.
- Core skill was corrected to reflect that the native Cairo renderer supports local images and clips but rejects native select controls. Previous wording that rejected both images and selects was stale.

The current project has 20 Coenx skills. The newly added rendering skill is also registered in the bundled skill catalogue.

### Documentation updated

- `packages/coenx-video/README.md`
- `docs/coenx-video.md`
- `docs/skills.md`

Docs now describe reusable paths/clips, current CML limits, AI tool names, server-safe import subpaths and the deferred GPU path.

### Skill parity

The following local/bundled pairs were compared and confirmed byte-identical after the latest edits:

- core Coenx Video
- rendering
- validation
- language

A specific parity test is present for the rendering skill. A generic whole-skill catalogue parity mechanism is not yet implemented. Add one if it can be done without making the bundler import non-text assets incorrectly.

---

## 7. Verification snapshot - latest actual results

Latest verification completed in the workspace on 2026-11-21.

### Coenx Video package

Command:

```sh
cd packages/coenx-video
export PATH="$HOME/.bun/bin:$PATH"
bun test
bun run typecheck
bun run lint
```

Results:

- **62 tests passed**
- **0 failed**
- **243 assertions**
- 11 test files
- TypeScript typecheck passed
- Oxlint passed with 0 warnings and 0 errors

The focused integration run also passed:

- path tests
- interactive browser tests for Canvas and SVG
- native video MP4 tests
- standard SVG/ImageMagick/FFmpeg tests
- 21 tests / 77 assertions in that focused set

### DB tool integration

Command:

```sh
cd packages/db
export PATH="$HOME/.bun/bin:$PATH"
bun test test/tool-coenx-video.test.ts
bun run typecheck
bun x oxlint src/tool/coenx-video.ts src/tool/builtins.ts test/tool-coenx-video.test.ts
```

Results:

- **7 tests passed**
- **0 failed**
- 11 assertions
- DB package TypeScript typecheck passed
- Targeted Oxlint passed with 0 warnings and 0 errors

### Rust native renderer

Command:

```sh
cd packages/coenx-video
cargo fmt --manifest-path native/coenx-video-native/Cargo.toml --all -- --check
cargo test --manifest-path native/coenx-video-native/Cargo.toml --offline
cargo clippy --manifest-path native/coenx-video-native/Cargo.toml --offline -- -D warnings
cargo build --manifest-path native/coenx-video-native/Cargo.toml --release --offline
```

Results:

- **9 Rust tests passed**
- 0 failed
- rustfmt check passed
- Clippy passed with warnings denied
- release build passed
- rebuilt native binary exists under `native/coenx-video-native/target/release/`

### Additional checks

- `git diff --check` returned no whitespace errors in the tracked diff.
- Project-local/bundled skill copies compared equal for the four pairs listed above.
- Prettier was run in write mode over the modified Coenx source/tests/docs and plan during the implementation. Re-run a targeted `prettier --check` before the next handoff/merge checkpoint, since subsequent edits to skill/docs/handoff files may not all have been included in the earlier check.

Do not treat these results as a guarantee that every unrelated package in the workspace passes. Only the packages/commands listed above were verified.

---

## 8. Current limitations and known gaps

1. **No CML path/clip/gradient syntax yet.** These features currently require the lower-level structured JSON/TypeScript composition model.
2. **No masks or filter graph.** SVG as a format can represent them, but the composition model and renderers do not yet provide shared supported semantics.
3. **No conic gradients, gradient transform, or repeat/reflect spread modes.** Current linear/radial model uses the existing pad-style behavior.
4. **No nested reusable path/clip graph.** Current path and clip resources each refer directly to a path definition and are bounded.
5. **No GPU 3D renderer.** Current mesh3d remains CPU-projected.
6. **No glTF import, skeletal/skin animation, full PBR, shadow maps or environment mapping.**
7. **No complete renderer-selection layer.** Capability metadata exists, but it is not yet a preflight planner that evaluates every composition's requirements and selects a renderer with a structured reason.
8. **No tool for scene inspection, preview, export or reference retrieval.**
9. **Validation tool is not project-file-aware.** It validates input strings and composition data, not asset existence/decoding.
10. **Main validator is still large.** `packages/coenx-video/src/model/validate.ts` is around 511 lines. Keep the package's under-300-line preference in mind and split validators by cohesive responsibility when doing related work.
11. **Tool capability matrix is hand-authored code data.** It is currently the single shared source for both exported package consumers and AI tool output. Do not duplicate it. Consider generating renderer feature entries from typed backend declarations once the renderer-selection layer exists.
12. **Full package-wide skill sync enforcement not present.** Only the new rendering skill currently has an automated project-local/bundled equality assertion.

---

## 9. Required next steps

### Immediate next task: WP2 - Masks and compositing

Continue from the reusable path/clip resource implementation. Design a bounded shared mask model before writing backend-specific implementations.

Recommended first vertical slice:

1. Inspect the current `Scene`, `NodeBase`, renderer grouping, save/restore and Cairo surface allocation behavior.
2. Define a narrowly scoped additive schema for reusable masks. Start with **alpha masks only**; luminance conversion can be a later separately capability-gated addition.
3. Decide and document mask coordinate semantics before implementation:
   - mask source view box
   - mask-to-node local bounds mapping
   - whether mask inherits the node transform (recommended for first version)
   - how content alpha and node opacity combine
   - explicit clipping/bounds
4. Prefer reusing the current PathDefinition and vector-node mechanisms for vector alpha mask shapes if semantics are sufficient; do not create redundant path formats.
5. Build a bounded compositor:
   - Canvas: use save/restore and a bounded offscreen surface where isolation is required; avoid allocating a full-stage offscreen canvas for every node.
   - SVG: emit generated safe `mask` definitions with explicit `maskUnits` / `maskContentUnits`; never accept raw caller-provided SVG.
   - Cairo: use bounded image surfaces/groups and ensure clip/mask state does not leak across nodes.
   - Static SVG and interactive SVG should share as much serialized resource logic as practical.
6. Set hard budgets: maximum mask resources per scene, mask nesting depth (prefer no nesting in v1), dimensions/pixel budget, temporary memory and total per-frame operations.
7. Reject a mask on any node/backend that cannot implement it. Never silently ignore it.
8. Add real pixel-level tests on Canvas and Cairo, SVG definition/DOM checks, and MP4 smoke tests on both static and native paths.
9. Add capability matrix entries and tests for every backend claiming mask support.
10. Update the core/rendering/validation skills and docs with exact supported semantics. The new tool matrix should report mask support when implemented.
11. Update the roadmap checkboxes and this handoff pointer only after the tests pass.

Avoid beginning the complete blur/drop-shadow/filter graph before masks are bounded and reliable. Effects are WP4.

### After WP2

**WP3 - Richer gradients and paint resources**

- Freeze current gradient behavior in tests first.
- Add spread modes (`pad`, `repeat`, `reflect`) and transformations as additive semantics.
- Consider reusable paint resources and a safe CML syntax.
- Ensure Canvas/SVG/Cairo parity. Mark per-renderer approximation explicitly if exact parity is impossible.

**WP4 - Bounded filter/effect graph**

- Start with Gaussian blur, drop shadow and color adjustment only.
- Bound filter radius, chain depth, output-region growth, temporary memory and per-frame work.
- Use generated/sanitized renderer definitions, never arbitrary caller-provided SVG filter markup or custom shaders.
- Add visual fixtures and cancellation/resource-budget tests.

**WP5 - CML authoring completeness**

- Add a concise declarative syntax for the shared model features only after their schema and backend semantics stabilize.
- Preserve version 1 compatibility where additive optional fields suffice.
- Do not make agent-generated projects embed raw JSON in attributes.
- Add source location/error diagnostics and round-trip fixtures.
- Do not describe a feature as CML-supported until parser + compiler + validator tests prove it.

**WP6 - AI tools (continue incrementally)**

- Add `coenx_video_inspect`: safe structured summary of scenes, resource/node IDs, timing, referenced assets and backend requirements.
- Add `coenx_video_preview`: bounded frame/thumbnail preview, low-resource defaults, cancellation and backend/fallback information. Return a managed file/image output using existing output materialization patterns, not giant inline base64 strings.
- Add `coenx_video_export`: standard MP4 or interactive export with project-root-safe source/output paths, render profile caps, cancellation/progress, no overwrites unless explicitly authorized, and final structured manifest containing backend/fallback details.
- Add `coenx_video_reference`: retrieve the relevant authoring/schema reference section with bounded output.
- Use `Tool.make`, typed Effect Schema, `Tools.Service.register`, canonical tool permission conventions and tests. Read `packages/db/src/tool/AGENTS.md` before modifying tool architecture.
- Test actual live registration through the builtin layer, not just isolated function execution.
- Keep each tool narrow and make all errors repairable and machine-readable.

**WP7 - Renderer selection and observability**

- Turn the feature matrix into a renderer planner: required feature set + output target + runtime capabilities + user preference -> selected backend and reason codes.
- Validate that unsupported features are rejected or a compatible fallback is selected before render begins.
- Record selected backend, fallback, per-stage timings, throughput and measurable memory/cache metrics.
- Add shared fixtures to compare every backend that claims support.

**WP8 - Proper GPU 3D (deferred)**

- Keep existing CPU projection running and tested.
- Define one scene contract before implementing two GPU renderers.
- Browser: Three.js/WebGL2 first; WebGPU optional and feature-detected.
- Native: Rust/wgpu offscreen rendering and readback.
- Preserve deterministic CPU evaluation for timeline/physics; GPU renderer consumes evaluated poses.
- On missing adapter/device, headless session, context/device loss, low-memory failure or unsupported features, automatically fall back to the CPU renderer or explicitly report why no backend can satisfy the project.
- Do not make React Three Fiber a requirement in the current browser runtime. An R3F adapter is only justified if a React host actually needs one.
- Add glTF, hierarchical assets, skeletal animation, PBR, shadow maps, texture/environment maps and advanced optimizations as separate gated features. Do not attempt them all in one patch.

---

## 10. Implementation rules for the next agent

### Before editing

- Read this handoff and `docs/plans/coenx-video-renderer-roadmap.md`.
- Read package-level AGENTS instructions for the exact packages in scope.
- Inspect current source; do not assume this handoff supersedes code.
- Check Git status, and preserve the existing state.
- Identify which tests cover the active behavior before changing it.

### While editing

- Implement vertical slices: model -> strict validation -> every claiming backend -> tests -> capability registry -> canonical AI tooling -> skills/docs.
- Preserve old serialized projects. Prefer optional additive fields and explicit adapters.
- Keep path/resource/temporary allocation bounded and cancellation-aware.
- Avoid external downloads and arbitrary file/path access.
- Never accept raw SVG/filter/shader source as an untrusted project escape hatch.
- No silent renderer fallback and no silent feature dropping.
- Keep native JSONL stdout protocol-only; log diagnostics to stderr.
- Keep source modules below 300 lines where possible. Split by cohesive responsibility, not artificial one-line abstractions.
- Keep generated or bundled skills synchronized with their project-local sources.

### After editing

Run targeted tests first. Before considering a milestone complete, run:

```sh
# Coenx Video
cd packages/coenx-video
export PATH="$HOME/.bun/bin:$PATH"
bun test
bun run typecheck
bun run lint

# Native renderer
cargo fmt --manifest-path native/coenx-video-native/Cargo.toml --all -- --check
cargo test --manifest-path native/coenx-video-native/Cargo.toml --offline
cargo clippy --manifest-path native/coenx-video-native/Cargo.toml --offline -- -D warnings
cargo build --manifest-path native/coenx-video-native/Cargo.toml --release --offline

# AI tool package
cd ../db
bun test test/tool-coenx-video.test.ts
bun run typecheck
bun x oxlint src/tool/coenx-video.ts src/tool/builtins.ts test/tool-coenx-video.test.ts
```

Do not report a pass unless the command ran against the latest changed source. Record environment limitations and skips separately from failures.

### Handoff upkeep

At the end of each meaningful slice:

- Update `docs/plans/coenx-video-renderer-roadmap.md` checkboxes, issue status and current execution pointer.
- Update this handoff's progress/status summary or create a dated successor handoff if the implementation has moved substantially.
- Record exact tests/commands and results.
- List known limitations and the next specific action.
- Do not claim tools, skills, renderer support or GPU acceleration that are not registered and verified.

---

## 11. Roadmap status at handoff

| Work package                                 | Status                           | Notes                                                                                                                     |
| -------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| WP0 - Preserve baseline and maintain roadmap | ACTIVE / ongoing                 | Roadmap exists; handoff now exists; keep current after each slice.                                                        |
| WP1 - Shared reusable paths and clipping     | IMPLEMENTED / verify maintenance | Reusable view-box path definitions and node-local clips work in static SVG, interactive SVG, Canvas and native Cairo/MP4. |
| WP2 - Reusable masks/compositing             | NEXT                             | Alpha-first design, coordinate/bounds rules, pixel tests.                                                                 |
| WP3 - Richer gradients/paint resources       | PLANNED                          | Current linear/radial gradients already work; spread/transforms/reusable paint/CML remain.                                |
| WP4 - Bounded filter/effect graph            | PLANNED                          | Blur/shadow/color adjustment after compositing foundations.                                                               |
| WP5 - CML authoring surface                  | OPEN                             | CML still lacks paths, clips and gradient literals.                                                                       |
| WP6 - AI tools/skills                        | ACTIVE / partial                 | Capability + validation tools and rendering skill are integrated; inspect/preview/export/reference remain.                |
| WP7 - Renderer planner/observability         | PLANNED                          | Capability document exists, actual renderer planner/telemetry does not.                                                   |
| WP8 - GPU 3D and CPU fallback                | DEFERRED                         | Future Three.js/WebGL2 + Rust/wgpu with current CPU renderer retained.                                                    |

### Exact next action

**Begin WP2 by designing and validating the alpha-mask schema, coordinate semantics and resource budgets before wiring any renderer.** Preserve the existing clipping implementation and use its path/resource resolution patterns where appropriate. Do not start GPU 3D.

---

## 12. File map

### Roadmap and handoff

- `docs/plans/coenx-video-renderer-roadmap.md`
- `docs/handoffs/coenx-video-renderer-handoff-2026-11-21.md` (this file)

### Coenx model, validation and authoring

- `packages/coenx-video/src/model/types.ts`
- `packages/coenx-video/src/model/validate.ts`
- `packages/coenx-video/src/model/validate-paths.ts`
- `packages/coenx-video/src/render/path.ts`
- `packages/coenx-video/src/format/compiler.ts`
- `packages/coenx-video/src/index.ts`
- `packages/coenx-video/src/capabilities.ts`
- `packages/coenx-video/src/validation.ts`

### Renderers

- `packages/coenx-video/src/render/scene-svg.ts`
- `packages/coenx-video/src/render/native.ts`
- `packages/coenx-video/src/runtime/canvas-renderer.ts`
- `packages/coenx-video/src/runtime/svg-renderer.ts`
- `packages/coenx-video/src/runtime/svg-primitives.ts`
- `packages/coenx-video/native/coenx-video-native/src/render.rs`
- `packages/coenx-video/native/coenx-video-native/src/render/path.rs`
- `packages/coenx-video/native/coenx-video-native/src/render/tests.rs`

### AI tools and skills

- `packages/db/src/tool/coenx-video.ts`
- `packages/db/src/tool/builtins.ts`
- `packages/db/test/tool-coenx-video.test.ts`
- `packages/db/src/plugin/skill/bundled/coenx-video/index.ts`
- `.agents/skills/coenx-video-rendering/SKILL.md`
- `packages/db/src/plugin/skill/bundled/coenx-video-rendering/SKILL.md`
- Core/language/validation skill copies are under matching `.agents/skills/coenx-video*/` and `packages/db/src/plugin/skill/bundled/coenx-video*/` directories.

### Tests

- `packages/coenx-video/test/path.test.ts`
- `packages/coenx-video/test/interactive-browser.test.ts`
- `packages/coenx-video/test/standard-render.test.ts`
- `packages/coenx-video/test/native-video.test.ts`
- `packages/db/test/tool-coenx-video.test.ts`

---

**Final instruction to the next agent:** Continue from the exact next action in Section 11. Treat the roadmap as a flexible sequence that can be adjusted when evidence demands it, but preserve the single-composition-model architecture, cross-renderer truthfulness, bounded resource use, canonical AI tool registration, skill synchronization and deterministic CPU fallback. The GPU 3D milestone is not forgotten; it is intentionally waiting its turn.
