# Studio Showcase - the motion-design reference project

This example exists to show what Coenx Video looks like when the
motion-design craft rules are applied: nothing fades alone, nothing enters
simultaneously, nothing sits static, and every scene ends with finishing
layers (grain + vignette).

## What it demonstrates

| Feature | Where |
| --- | --- |
| Custom font beyond the 16 bundled families | `<font family="Unbounded" src="assets/fonts/Unbounded.ttf">` (headlines) |
| Four font families in one piece | Unbounded, Space Grotesk, JetBrains Mono, Geist |
| Embedded video node | `<video asset="broll" fit="cover">` (scene 3, ffmpeg frame decode) |
| Animated GIF node | `spinner.gif` top-right of the title scene (frame-by-frame) |
| External image + AI photo | `assets/logo.svg` and `assets/photo.png` (JPEG bytes with a .png name - the decoder sniffs magic bytes) |
| Stat count-ups | `count-from/count-to/count-decimals/count-prefix/count-suffix` + `textProgress` easing |
| New easings | `back-out`, `expo-out` entrances; overshoot pops; ease-in-out Ken Burns |
| Staggered entrances | stat cards at frames 8/16/24, buttons at 34/42 |
| Finishing layers | `filter="grain(0.16 2) vignette(0.55 0.6)"` full-bleed rects |
| Synthesized SFX | ffmpeg-generated WAVs wired as `sfx` audio clips |
| Scene transitions | zoom / fade / slide-left |
| Interactive branching | quiz buttons + replay buttons (project.js events) |

## Commands

    bun packages/coenx-video/src/cli.ts validate examples/studio-showcase/project.cml
    bun packages/coenx-video/src/cli.ts render examples/studio-showcase/project.cml \
      --out examples/studio-showcase/renders/showcase.mp4 --renderer native --profile quality
    bun packages/coenx-video/src/cli.ts pack examples/studio-showcase/project.cml \
      --out examples/studio-showcase/renders/showcase.coenx4
    bun packages/coenx-video/src/cli.ts validate-container examples/studio-showcase/renders/showcase.coenx4
    bun packages/coenx-video/src/cli.ts unpack examples/studio-showcase/renders/showcase.coenx4 \
      --out /tmp/showcase-unpacked

The `.coenx4` container holds the embedded composition (all media and the
custom font as data URIs), a self-contained offline `player.html`, the raw
media files and a manifest. Open the player in any browser - no network
needed - press Play, then use the quiz buttons and the replay jumps.
