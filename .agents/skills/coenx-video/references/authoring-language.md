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

Supported triggers: click, submit, change, key, and timer. Supported actions: set, increment, goto, show, hide, feedback, playAudio, and emit. when accepts only the expression AST: literal, state, event, eq, neq, gt, gte, lt, lte, and, or, not, and contains. Use nested data objects for expressions. All actions and expressions are validated before the composition is created.

Never add JavaScript evaluation or make the compiler execute source strings. Never put server secrets, private grading state, model credentials, filesystem paths, or untrusted HTML into a learner project.
