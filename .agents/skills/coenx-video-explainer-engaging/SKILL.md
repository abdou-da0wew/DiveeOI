---
name: coenx-video-explainer-engaging
description: Build a short, continuous product-workflow story in which one visual hero travels between workflow stations. Use for 10–30 second launch loops, product teasers and concise "input to outcome" stories.

metadata:
  category: video
  author: DiveeOI
  version: 1.0.0
  license: MIT
  sourceRepository: https://github.com/Barty-Bart/motion-graphics
  sourceRevision: "3d83d987d658601d8a1269eb691622bdcd427335"
---

# One-take workflow explainer

Adapted from Barty-Bart's MIT-licensed explainer-engaging skill; source and credits: third_party/motion-graphics/skills/explainer-engaging/.

## Creative mechanism

One hero object represents the user's idea, file, task or data. It travels through three to five stations that explain a real product workflow. The hero remains visually identifiable; each station reacts as the object arrives. End by pulling the composition back conceptually to reveal the entire journey.

The upstream style's default is a 12-second loop. For DiveeOI, use 12–18 seconds for a loop, 20–30 seconds for a more explanatory cut. A loop must return naturally to a visually compatible opening state.

## Planning

For each station, record:

- The confirmed workflow step.
- What changes when the hero arrives.
- The specific output/result that is true of the product.
- Approximate frame range and hold time.
- Whether the narration/text is essential.

Use a small number of meaningful stations. A continuous line of movement is not a substitute for explaining what happened.

## Coenx implementation

Use one scene when possible. Animate the hero node's position between station coordinates with keyframes. Give each station a stable id and reveal its caption/indicator as the hero reaches it. Use a consistent grid and z-order. If one scene becomes hard to read, split into scenes and use a shape/circle as a visual handoff.

The current engine has no parent/child transform groups, arbitrary camera pan/zoom track or path-follow animation. Therefore calculate each node's coordinates directly and keyframe them. Do not use a fictional camera API.

## Review

Check that:

- The hero's identity and size remain consistent.
- Each station is visually distinct and the workflow order is obvious.
- The viewer can read each label before the hero leaves.
- No fake API response, benchmark or product capability is implied.
- The end state can loop to the opening without a visible jump, if requested.

Use the parent coenx-video skill for validation and MP4 rendering. Output a standard MP4 by default. Use an interactive project only when the user explicitly wants the stations to respond to input.
