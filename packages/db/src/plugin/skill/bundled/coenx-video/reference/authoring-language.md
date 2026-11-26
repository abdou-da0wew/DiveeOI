# Coenx Authoring Language v1

A project has three source files: project.cml, project.css, and project.js. They compile into the versioned VideoComposition model used by both standard MP4 rendering and the interactive browser runtime.

## Markup: .cml

The document is XML-inspired and must have exactly one coenx root.

    <coenx id="example" title="Example lesson" width="1280" height="720" fps="30" background="#090d15">
      <asset id="diagram" src="media/diagram.png" />
      <scene id="intro" duration="4s" background="#101827">
        <text id="headline" class="title" x="640" y="240" width="900" height="90">
          A clear idea
          <animate property="opacity" from="0" to="1" start="0" end="24" easing="ease-out" />
        </text>
        <rect id="card" class="card" x="640" y="390" width="760" height="220" />
        <button id="continue" class="primary" x="640" y="560" width="240" height="64">Continue</button>
        <image id="diagram-image" asset="diagram" x="640" y="390" width="500" height="240" />
      </scene>
      <audio id="intro-bed" src="media/intro.wav" kind="music" start="0" duration="4s" volume="0.2" />
    </coenx>

Coordinates are stage-space pixels, centered on each visual node. A scene duration accepts Ns or a frame count via frames. Scene nodes currently supported are rect, ellipse, line, text, image, button, input, and select. Asset and audio paths must stay project-relative. Use direct asset, audio, and citation children of coenx.

animate is a child of its visual node. It currently supports numeric keyframed properties x, y, width, height, rotation, scaleX, scaleY, opacity, and fontSize. Use increasing frame numbers and bounded keyframe counts.

Educational projects set mode="education" and objective="..." on coenx, then add one or more citation elements with bookId, passageId, title, and page attributes. These identifiers must come from retrieved DiveeOI learning sources, never invented.

## Styling: .css

The stylesheet is intentionally not browser CSS. It supports only tag, .class, and #id selectors and a safe static-property subset:

x, y, width, height, fill, stroke, stroke-width, border-radius, background, color, opacity, rotation, font-family, font-size, font-weight, text-align, line-height, z-index, visibility.

No imports, at-rules, nested selectors, pseudo-selectors, URL values, custom properties, var(), or !important. Font family must be a name in the bundled font catalogue. Keep styles declarative and deterministic.

## Script: .js

The .js file is a JavaScript-like data module, not executable JavaScript. It is parsed as an object literal after export default; it does not support function declarations, callbacks, imports, expressions, loops, property access, or arbitrary statements.

    export default {
      state: { selected: "", score: 0 },
      events: [
        {
          id: "choose-cairo",
          scene: "question",
          on: "click",
          target: "#answer-cairo",
          actions: [
            { type: "set", key: "selected", value: "cairo" },
            { type: "set", key: "score", value: 1 },
            { type: "feedback", text: "Correct.", tone: "success" }
          ]
        }
      ]
    }

## World model: triggers, statements, expressions and live physics

Interactive scenes can behave like small worlds. On top of the base triggers (click, submit, change, key, timer) the world model adds three pointer/physics triggers:

- `hover` with `phase: "enter" | "leave"` - restyle targets on pointer enter/leave.
- `drag` with `phase: "start" | "move" | "end"` - fired after a 4px movement threshold with grab-offset tracking so grabbed bodies do not jump. Dragging a node that owns a physics body makes the body kinematic; on release it keeps the fling velocity.
- `collide` with optional `withId` - fired by the live physics step once per new overlap pair.

Statement actions: the base set (`set`, `increment`, `goto`, `show`, `hide`, `feedback`, `playAudio`, `emit`) plus `run` (nested statement list, at most 8 levels deep and 24 actions per interaction), `gotoFrame` (scene-local seek), `setNode` (override `text`, `x`, `y`, `rotation`, `opacity`, `scale` or `color` of one node; overrides beat keyframes, are snapshotted per scene and restored on navigation; on solid-fill shapes `color` restyles `fill`) and `impulse` (add vx/vy to a live physics body).

Expressions are a validated AST. Beyond the boolean set (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`, `contains`) the world model adds arithmetic and helpers: `add`, `sub`, `mul`, `div`, `mod`, `concat`, `min`, `max`, `abs`, `round`, `floor`, `ceil`, `clamp`, bounded `random` and the ternary `if`. Pointer triggers carry `event.x` / `event.y` stage coordinates, so actions can react to where the viewer clicked or dragged.

A scene can declare `physics`: `gravity` as `[gx, gy]` and `bodies` bound to node ids with `mass`, `velocity`, `size`, optional `isStatic`, `restitution` and `position`. While the world plays, the player steps this physics live: bodies move, collisions fire `collide` interactions and dragged bodies follow the pointer. The static MP4/SVG render path keeps using the pre-batched deterministic simulation, so both outputs derive from one scene definition. Validation bounds the model: at most 500 2D bodies per scene, 24 actions per interaction, 8 nested `run` levels and expression depth 16.

Use the world model when the viewer must manipulate, throw, collide or observe cause and effect; keep flat MP4 for cinematic playback. Never add JavaScript evaluation or make the compiler execute source strings. Never put server secrets, private grading state, model credentials, filesystem paths, or untrusted HTML into a learner project.
