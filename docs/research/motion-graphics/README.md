# Motion-graphics research archive

Downloaded and adapted on **2026-11-20** for DiveeOI's `coenx-video` package. This folder is a source archive; the project-discoverable adaptations live under `.agents/skills/`.

## Awesome Claude: 17 style prompts

Source: https://awesomeclaude.ai/claude-motion-graphics (page last updated **2026-10-21**).

- `awesomeclaude-motion-graphics.html` — original downloaded page HTML.
- `awesomeclaude-motion-graphics-SKILL.md` — the page's downloadable generic motion-graphics skill.
- `assets/` — the page's Nuxt JavaScript and CSS bundles plus page payload; the compiled bundle contains the complete 17-style prompt data.
- `site/index.html` and `site/_nuxt/` — local snapshot with same-origin Nuxt assets placed alongside the HTML for offline inspection. Its local copy removes the remote GitHub-button widget and decorative logo image requests; the visible brand text remains. The source host timed out when fetching its Inter font binaries, so the offline CSS removes the unavailable Inter face and uses the bundled local Geist and Geist Mono WOFF2 files from packages/coenx-video/assets/fonts/. The original downloaded HTML and CSS are preserved unchanged under the archive files/assets.
- `awesomeclaude-style-prompts.json` — all 17 original style records, including their names, purpose, suggested stack, palettes, numeric rules, avoid lists and complete copy prompts.
- `awesomeclaude-style-prompts.md` — readable rendering of the same archive.
- `coenx-style-adaptations.json` — the same source records with DiveeOI compatibility notes, primitive mapping, resource profile and unsupported-feature boundaries.

The source page's FAQ explicitly permits the author-written prompt templates to be pasted into any prompt or skill. The page itself does not declare a conventional SPDX license, so this archive retains its source URL, date and attribution rather than relabeling it as MIT.

## Barty-Bart motion-graphics repository

Upstream: https://github.com/Barty-Bart/motion-graphics

- Default branch: `main`
- Cloned commit: `3d83d987d658601d8a1269eb691622bdcd427335`
- Commit date: `2026-10-13`
- Local clone: `third_party/motion-graphics/`
- Repository license: MIT, Copyright (c) 2026 Bart. The original LICENSE is preserved verbatim.

The full clone includes six upstream skills: `explainer-default`, `explainer-engaging`, `explainer-high-energy`, `motion-broll`, `object-separation` and `sound-effects`, plus their helper scripts, demos, sample media, fonts and sound library. Do not delete the nested `.git` directory if you want to keep the clone and inspect future upstream revisions.

The repository's other assets have separate terms: Geist fonts are SIL Open Font License 1.1, Lucide-derived icon paths are ISC, and the sound library's per-asset source/license information is recorded in `skills/sound-effects/LICENSES.md`. The SFX README describes the bundled SFX collection as CC0 1.0; consult the per-asset record and `MUSIC.md` before using anything. The upstream license/credits files remain next to the source assets.

## DiveeOI adaptations

Project-level skills are available under `.agents/skills/`:

| Skill                               | Adaptation                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `coenx-video`                       | Output selection, storyboard, authoring, standard MP4, interactive export, verification and resource constraints |
| `coenx-video-styles`                | All 17 styles mapped to supported coenx primitives and honest asset-assisted fallbacks                           |
| `coenx-video-explainer-default`     | Restrained 45–90 second product demo with truthful UI                                                            |
| `coenx-video-explainer-engaging`    | One-hero workflow story and short loop                                                                           |
| `coenx-video-explainer-high-energy` | Beat-aware 12–20 second launch promo                                                                             |
| `coenx-video-motion-broll`          | Transcript-timed standalone cutaway clips and editor timing sheet                                                |
| `coenx-video-object-separation`     | Optional, explicitly approved local SAM 2.1 preprocessing with conservative resource limits                      |
| `coenx-video-sound-design`          | Timeline-based music/SFX design using license-checked local assets                                               |
| `coenx-video-language`              | Coenx markup, CSS subset and declarative JavaScript-like interaction source                                     |
| `coenx-video-interactive`           | Canvas player, accessible controls, branching and interaction state                                              |
| `coenx-video-svg-motion`            | Vector scenes, SVG rendering, Canvas playback and geometry                                                       |
| `coenx-video-motion-design`         | Timeline, keyframes, typography motion and pacing                                                                |
| `coenx-video-typography`            | Font pairing and script-aware typography guidance                                                                |
| `coenx-video-fonts`                 | Full local font catalogue, WOFF2 files and per-family licenses                                                   |
| `coenx-video-accessibility`         | Keyboard, touch, caption, contrast and motion-comfort guidance                                                   |
| `coenx-video-learning`              | Source-grounded Targeted Learning interactions and feedback                                                     |
| `coenx-video-physics`               | Lightweight physics scenes and simulation limits                                                                |
| `coenx-video-storyboard`            | Scene planning, narration beats and visual narrative                                                             |
| `coenx-video-validation`            | Source validation, output checks and interactive test guidance                                                   |

The DiveeOI skills are rewritten for the existing package API and runtime. They do not instruct the agent to invoke HyperFrames, GSAP, Playwright, arbitrary HTML rendering or other unavailable APIs. They call out current gaps such as source-video compositing, transparent ProRes output, arbitrary SVG path morphs, brush engines, custom shaders and motion blur.

The server's existing Skill discovery scans project `.agents/skills/**/SKILL.md`, so these skills are discoverable without a dedicated registry code change. That is skill discovery only: it does not yet add a dedicated `coenx_video` tool, route or finished UI workflow.

## Offline inspection

Serve the archived page folder locally:

```sh
python3 -m http.server 8080 --directory docs/research/motion-graphics/site
```

Then open `http://127.0.0.1:8080/`. The JSON and Markdown prompt archives are the reliable offline source for all 17 full prompt texts even if the site's third-party widgets no longer load.
