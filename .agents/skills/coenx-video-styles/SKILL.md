---
name: coenx-video-styles
description: Choose and adapt one of 17 quantified motion-design styles for coenx-video compositions. Use when the user requests a visual look, a style prompt, consistent art direction or a named motion-graphics treatment.

metadata:
  category: video
  author: DiveeOI
  version: 1.0.0
  license: Source-author prompt reuse permission; retain attribution
  sourceRepository: https://awesomeclaude.ai/claude-motion-graphics
  sourceRevision: "2026-10-21"
---

# Coenx video style library

The complete original source prompts and style metadata are archived at:

- ../../../docs/research/motion-graphics/awesomeclaude-style-prompts.json
- ../../../docs/research/motion-graphics/awesomeclaude-style-prompts.md

The page author explicitly permits copying the prompt templates into prompts and skills. Preserve the original source credit in derivative materials. The original page HTML, JS/CSS payload and downloaded skill are in docs/research/motion-graphics/; the separate Barty-Bart MIT repository is in third_party/motion-graphics/.

## Selection rule

Choose one dominant style per video. Combine a second style only for a specific scene whose purpose justifies the change. Keep the source's numeric values as a starting point, but translate techniques to what the coenx renderer actually supports.

| Style                      | Good use                             | Coenx implementation                                                                        |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Swiss grid & kinetic type  | Brand identity and conference titles | Native grid-aligned text, rects and lines                                                   |
| Flat vector explainer      | Science and onboarding               | Native flat shapes and keyframes                                                            |
| Shape morph & liquid       | Brand stories and transitions        | Asset-assisted; arbitrary path morph/liquid shaders are not native                          |
| Single line & live drawing | Whiteboard and minimalist explainers | Asset-assisted; animated path reveal is not native                                          |
| Data story                 | Reports and quantitative lessons     | Native bars, labels and exact data-driven values                                            |
| Isometric miniature world  | Systems and process explainers       | Approximate with mesh triangles/screen-space layout; true orthographic camera is not native |
| Dark tech keynote          | AI and product launches              | Native dark stage, limited accent, shapes and basic mesh3d                                  |
| Living UI screencast       | Product walkthroughs                 | Native simplified UI nodes and controls; arbitrary HTML layouts are not native              |
| HUD & terminal             | Developer/AI explainers              | Native monospace text, lines and rects                                                      |
| Watercolour & ink          | Nature and narrative                 | Asset-assisted paper/brush texture; no native brush engine                                  |
| Risograph & halftone print | Editorial/event posters              | Asset-assisted halftone texture; flat ink colors are native                                 |
| Paper cut-out & collage    | Editorial and playful stories        | Native layered images/shapes and stepped keyframes; no native shadow filter                 |
| Hand-drawn line boil       | Character shorts                     | Asset-assisted; seeded per-frame stroke jitter is not native                                |
| Pixel art & retro game     | Retro/gaming explainers              | Create low-resolution source artwork and preserve nearest-neighbour pixels in the asset     |
| VHS, film & CRT eras       | Retro/teaser pieces                  | Asset-assisted texture overlays; no native post-FX shader                                   |
| Toy & material 3D          | Product films                        | Basic low-poly mesh3d only; use baked image assets for material/DOF                         |
| Vertical social captions   | Shorts/Reels                         | Native 9:16 text and keyframe timing with phone-safe margins                                |

## Adaptation contract

1. Read the selected style's full original prompt, palette, rules and avoid list from the JSON archive.
2. Keep numeric values that remain valid: palette hex codes, columns, margins, frame counts, line widths and stepping rates.
3. Translate source easing curves to supported linear, ease-in, ease-out, ease-in-out or step. Do not claim exact cubic-bezier support.
4. If the style requires path morphing, masks, textures, blur, particles, custom shaders or arbitrary DOM, use a locally generated asset only when it is deterministic, project-owned and licensed. Otherwise simplify the treatment and disclose the compromise.
5. Use seeded randomness for any authored raster/SVG texture so the same frame is reproducible.
6. Respect readable type, contrast, phone safe zones and source-backed numbers. The style must never make a scientific lesson less accurate.

## Numeric authoring defaults

- Author positions and animation in stage pixels/frames, not seconds rounded by eye.
- At 1080p, body copy should usually remain 30px or larger; small metadata needs strong contrast and a deliberate hold.
- For 9:16 social output, keep critical content inside the central 80% and away from the platform UI zones.
- Avoid unseeded randomness and frame-by-frame state accumulation in authored visuals.
- Prefer one focal subject and one accent color per shot unless the selected style explicitly calls for layered inks.

## Source credit

Styles and prompts adapted from Awesome Claude, “Claude motion graphics: 17 styles,” updated 2026-10-21: https://awesomeclaude.ai/claude-motion-graphics. Full source prompt archive and retrieval snapshot are retained in DiveeOI docs.

## Bundled style references

The complete 17-style prompt library is available as the embedded resource references/style-prompt-library.md. The companion references/style-capability-map.json records which style elements are native, asset-assisted or unsupported by the current renderer. Read the mapping before promising a technique. Translate style intent into supported Coenx primitives; do not paste external framework code into a CML project.
