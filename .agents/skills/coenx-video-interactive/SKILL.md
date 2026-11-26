---
name: coenx-video-interactive
description: Design and implement interactive canvas video experiences, mini-lessons, branching explainers, quizzes, guided demos, viewer state, controls, live physics worlds and feedback using the Coenx player.
---

# Interactive Canvas video

Choose interactive output only when the viewer must make a choice, answer, explore, navigate, manipulate an object or receive personalized feedback. If the deliverable is meant to play as an ordinary video, use the MP4 renderer. If the viewer only watches, do not add interactions for their own sake.

The browser runtime supports both Canvas and SVG visual stages, selected with the player renderer option; Canvas is the default for dense scenes and SVG is useful for crisp vector scenes and DOM-level inspection. Both modes provide accessible HTML controls for supported button, input and select nodes. Composition data is serializable. Interactions use a validated AST and finite state, not executable source. Use scene IDs, node IDs, state keys and event IDs as stable identifiers.

Define initial state in the script data module. Bind controls to existing state keys. Add a `when` expression for conditional rules. Do not store answer keys or private grading decisions in learner-visible project JSON.

## World model — triggers, statements, expressions, physics

Beyond the base triggers (`click`, `submit`, `change`, `key`, `timer`), scenes can behave like small worlds:

- **Triggers**: `hover` (`enter`/`leave` phases) restyles targets; `drag` (`start`/`move`/`end` phases, 4px threshold, grab-offset tracking) moves objects; `collide` (optional `withId` partner) fires once per new physics overlap. Pointer triggers carry `event.x`/`event.y` stage coordinates.
- **Statements**: `run` (depth-bounded statement lists, max 8 levels / 24 actions), `gotoFrame` (scene-local seek), `setNode` (text/x/y/rotation/opacity/scale/color overrides that beat keyframes, snapshot-restored per scene; on solid-fill shapes `color` restyles `fill`) and `impulse` (adds velocity to a live physics body).
- **Expressions**: boolean/comparison logic plus arithmetic `add/sub/mul/div/mod`, `concat`, `min`/`max`, `abs/round/floor/ceil`, `clamp`, bounded `random` and ternary `if`. Compose them to drive HUD text (`concat` of literals and state) and conditional actions.
- **Live 2D physics** (`src/physics/live.ts`): scenes with `physics` run a frame-stepped world in the player — gravity, mass/restitution, circle/box collisions, kinematic drags that keep a fling velocity on release, and once-per-overlap collision events feeding `collide` interactions. The pre-batched static simulation still drives MP4/SVG renders, so one scene definition serves both outputs.

Canonical patterns (see the world-showcase scripts for full compositions):

- **Kick and score**: a `click` trigger whose `run` list increments state, applies an `impulse` to the physics body and updates a HUD text node through a `concat` expression.
- **Hover feedback**: `hover` enter/leave pairs calling `setNode` with a `scale` prop; always restore on leave.
- **Throw with physics**: `drag` `move` updates a hint node; `drag` `end` gives feedback while the live world keeps the fling velocity; `collide` on the thrown body counts bounces into state.
- **Heat a gas (physics explainer)**: a chamber scene with gravity `[0, 0]`, elastic walls (restitution ~0.9) and many small molecule bodies. One interaction per molecule applies its share of the thermal kick and a `setNode` color change, so one Heat button drives the whole gas; a Cool button reverses it. Collide counters show molecular interaction rates. This teaches temperature as particle motion — use it for concepts like particle speed, pressure and diffusion, not for precise thermodynamics.

## Interaction loop and accessibility

Provide a deliberate interaction loop: orient the viewer, state the task, allow a clear action, show immediate meaningful feedback, explain the underlying concept, and offer a next step. Avoid requiring hover for essential information. Make targets comfortably large and keep keyboard focus predictable.

The player supports bounded frame rate, capped device pixel ratio, visibility-aware pausing and lazy audio unlock. Keep the stage responsive; do not allocate large canvases or create one DOM element per decorative shape. Use Canvas or SVG for visuals and the DOM overlay for text entry and accessible interaction. Keep controls as real HTML elements rather than drawing fake input fields only.

The DiveeOI session side panel (`.coenx4` viewer tab) mounts the player paused with play/pause and restart controls in the panel header, auto-opens for `coenx_video_export`, `coenx_video_pack` and `coenx_video_lesson` outputs, and bubbles `coenx:event` to the host page. Design worlds so the first scene also communicates with the clock stopped (visible title/first frame), because playback starts on the viewer's play action.

## Validation and safety

Interactive export is a static project folder containing the composition, local media, browser runtime, HTML shell and manifest. It is not a secure exam backend. Never rely on client state for sensitive grading, entitlements or secrets. Do not introduce eval, Function, dynamic imports, arbitrary HTML or arbitrary script execution.

Stay within validated bounds: at most 500 2D physics bodies per scene, 24 actions per interaction, 8 nested `run` levels, expression depth 16, velocity clamped at 4000 px/s and at most 12 physics steps per rendered frame. Prefer keyframes over physics for exact cinematic blocking, and never keyframe the same position components a physics body owns.
