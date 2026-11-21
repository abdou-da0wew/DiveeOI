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
