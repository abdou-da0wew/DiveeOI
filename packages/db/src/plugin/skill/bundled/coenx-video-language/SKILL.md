---
name: coenx-video-language
description: Author or debug Coenx video source files using the custom .cml markup, .css visual style subset and safe data-only .js event modules. Use whenever editing, explaining, validating or converting those three source files.
---

# Coenx language authoring

Read the embedded reference resource named references/authoring-language.md before creating source. The format has three coordinated files: project.cml for structure and scene content, project.css for a bounded visual-style subset, and project.js for a restricted declarative interaction module.

The compiler is the authority. Do not invent HTML, browser CSS, React, GSAP, or real JavaScript support where the parser does not provide it. The script file only parses a JavaScript-like object literal and maps it to DiveeOI's validated expression and action AST. No functions, imports, arbitrary expressions, network calls or dynamic evaluation exist.

Use stable unique IDs for scenes, nodes, tracks, events and state keys. Keep stage geometry in pixels and timeline values in frames unless a duration field explicitly accepts seconds. Keep asset paths relative to the project root. Use IDs for control triggers and explicit scene names for scene-local events.

Validate the CML tree, CSS rules and script AST before rendering. On an error, fix the source rather than silently dropping an unsupported element or property. Keep education citations tied to retrieved passage IDs. Never fabricate citations or learner answers.

The current CML node set is rect, ellipse, line, text, image, button, input and select. The lower-level composition API also supports mesh3d, but CML v1 does not expose it yet. Arbitrary SVG path data, filters, masks, gradients, imported stylesheets, arbitrary selectors, custom properties and JavaScript callbacks are not part of v1. Use supported primitives and polylines when they accurately express the visual.\n\n

## Structured model features outside CML v1

The versioned JSON/TypeScript composition model supports inline and reusable vector paths, scene-level path definitions, node-local clip paths with `nonzero` and `evenodd` fill rules, and linear/radial gradient paint values. These are not CML v1 tags, attributes or CSS literals. Do not invent path or clip markup. When a project requires these features, author a structured VideoComposition JSON value and validate it with `coenx_video_validate` using `format: "json"`. Check `coenx_video_capabilities` first. Masks, filter effects and GPU 3D are not implemented.

## Reusable resources and CML defs (v1.1)

CML scenes can declare reusable resources in a `<defs>` block inside `<scene>`:

- `<path id="wave" d="M 0 50 Q 25 0 50 50 Z" viewBox="100x100" fill-rule="evenodd"/>` compiles to a scene path definition. The `d` mini-syntax supports M, L, Q, C and Z commands with x,y pairs (256-command budget). Coordinates use top-left view-box units.
- `<clip id="frame-clip" path="wave" fill-rule="evenodd"/>` compiles to a clip-path definition referencing a path resource.
- `<mask id="fade" viewBox="100x60">` with `<rect x y width height rx? fill fill-opacity?>`, `<ellipse cx cy rx ry fill>` and `<path d fill fill-rule? opacity?>` shape children compiles to a reusable alpha mask (only shape alpha affects the result; luminance masks are not implemented).
- `<gradient id="brand" type="linear|radial" from="x,y" to="x,y" | center="x,y" radius="r" spread="pad|repeat|reflect">` with `<stop offset="0" color="#rrggbb" opacity="0..1"/>` children compiles to a reusable paint resource. Linear/radial gradients accept spread modes and `rotate`, `translate="x,y"` and `scale="x,y"` transform attributes (Canvas playback only supports pad spread and reports it).
- Node references: `fill="url(#gradient-id)"`, `clip="clip-id"`, `mask="mask-id"`; path nodes themselves: `<path id="curve" x y width height path-ref="wave" fill stroke stroke-width line-cap line-join>` (or inline `d="..."` instead of path-ref).
- Every compiler error carries a `(line X, column Y)` source location plus a repair hint; fix every diagnostic and validate again before rendering.

Do not hand-write serialized JSON inside attributes; use the declarative syntax above.
