# recovery-title example

A 13.5 second, 1280x720@30 motion-graphics title card that exercises the
features landed by the renderer roadmap (WP2-WP7) through the three-file
Coenx source language:

- scene `hook`: reusable alpha masks (`band-top`, `band-mid`) drive the
  chromatic slice copies of the headline, a gradient rect is clipped by a
  reusable wave path (`waveclip`), the headline carries a
  `drop-shadow(...)` effect chain, and blurred radial-gradient glow
  ellipses drift behind everything.
- scene `features`: staggered feature chips with drop shadows, a
  `spread="repeat"` linear gradient strip with capsule mask ends, and a
  rotating reusable diamond path filled by a shared gradient paint.
- scene `outro`: gradient diamond mark, keyframed rotation/scale entrance,
  and a closing hold.

## Render

Build the native sidecar first (`bun run build:native` in
packages/coenx-video), then from the repo root:

    bun packages/coenx-video/src/cli.ts validate packages/coenx-video/examples/recovery-title/project.cml
    bun packages/coenx-video/src/cli.ts render packages/coenx-video/examples/recovery-title/project.cml \
      --out "$PWD/packages/coenx-video/examples/recovery-title/recovery-title.mp4" \
      --profile balanced --renderer native

`--out` resolves relative paths against the project root, so pass an
absolute path (or a path relative to the project root's parent structure
you actually want). Verify the result with ffprobe and by inspecting
frames - a clean exit alone is not sufficient.
