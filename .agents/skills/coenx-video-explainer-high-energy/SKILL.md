---
name: coenx-video-explainer-high-energy
description: Create a 12–20 second high-energy launch promo with beat-aware kinetic typography, shape-led transitions and a clear product reveal using coenx-video. Use for hype promos, short teasers and energetic social launch clips.

metadata:
  category: video
  author: DiveeOI
  version: 1.0.0
  license: MIT
  sourceRepository: https://github.com/Barty-Bart/motion-graphics
  sourceRevision: "3d83d987d658601d8a1269eb691622bdcd427335"
---

# High-energy launch promo

Adapted from Barty-Bart's MIT-licensed explainer-high-energy skill. Original implementation and credits are retained at third_party/motion-graphics/skills/explainer-high-energy/.

## Energy without noise

Default length: 15 seconds. Build a strong visual beat every 1–2 seconds, but do not make every beat a sound hit or a new paragraph. Each shot needs one focal element and one real message. A useful sequence is: hook → problem → product reveal → two proof-of-work moments → final name/CTA.

Use exact brand colors. If no brand is supplied, pick a compact palette and keep it stable. Large type, strong contrast and decisive shapes do more work than glow, particles and lens flares.

## Beat-aware timing

If the music file is available, inspect its tempo and place important scene/shape transitions around deliberate beats. Keep the frame clock as the source of truth; do not derive visual timing from an uncontrolled playback clock. Use AudioClip.startFrame, durationFrames, volume and fades to line up the mix.

An audio beat grid must be measured from the supplied track. Never invent a BPM. If analysis is unavailable, use a regular editorial rhythm rather than claiming beat synchronization.

## Shape-led transitions

Prefer a rect, ellipse or other large shape that grows or moves to carry attention into the next scene. The package currently supports fade, slide-left and slide-right scene transitions and frame-keyframed node transforms. A full arbitrary mask wipe, SVG path morph or shader transition is not a native feature; simplify the transition or prepare a local licensed asset.

## Production limits

- Keep important on-screen copy concise and readable.
- Use at most one significant sound hit per meaningful beat.
- Don't animate every node simultaneously.
- No fake stats, fabricated customer quotes or unverified launch claims.
- Never use unseeded particles or frame-dependent random values.

Render a low-resolution/low-profile draft first, inspect several sampled frames, then render the final. If the intended device is resource constrained, prefer 720p/24–30 fps over 4K/60. Use the parent coenx-video skill for the export contract.
