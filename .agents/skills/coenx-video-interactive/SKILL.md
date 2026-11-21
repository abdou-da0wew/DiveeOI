---
name: coenx-video-interactive
description: Design and implement interactive canvas video experiences, mini-lessons, branching explainers, quizzes, guided demos, viewer state, controls and feedback using the Coenx player.
---

# Interactive Canvas video

Choose interactive output only when the viewer must make a choice, answer, explore, navigate, or receive personalized feedback. If the deliverable is meant to play as an ordinary video, use the MP4 renderer.

The browser runtime supports both Canvas and SVG visual stages, selected with the player renderer option; Canvas is the default for dense scenes and SVG is useful for crisp vector scenes and DOM-level inspection. Both modes provide accessible HTML controls for supported button, input and select nodes. Composition data is serializable. Interactions use a validated AST and finite state, not executable source. Use scene IDs, node IDs, state keys and event IDs as stable identifiers.

Define initial state in the script data module. Bind controls to existing state keys. Use click, change, submit, key or frame timer triggers. Use set and increment for state changes, goto for navigation, show/hide for staged reveals, feedback for immediate response, playAudio for SFX and emit for integration events. Add a when expression for conditional rules. Do not store answer keys or private grading decisions in learner-visible project JSON.

Provide a deliberate interaction loop: orient the viewer, state the task, allow a clear action, show immediate meaningful feedback, explain the underlying concept, and offer a next step. Avoid requiring hover for essential information. Make targets comfortably large and keep keyboard focus predictable.

The player supports bounded frame rate, capped device pixel ratio, visibility-aware pausing and lazy audio unlock. Keep the stage responsive; do not allocate large canvases or create one DOM element per decorative shape. Use Canvas or SVG for visuals and the DOM overlay for text entry and accessible interaction. Keep controls as real HTML elements rather than drawing fake input fields only.

Interactive export is a static project folder containing the composition, local media, browser runtime, HTML shell and manifest. It is not a secure exam backend. Never rely on client state for sensitive grading, entitlements or secrets. Do not introduce eval, Function, dynamic imports, arbitrary HTML or arbitrary script execution.\n
