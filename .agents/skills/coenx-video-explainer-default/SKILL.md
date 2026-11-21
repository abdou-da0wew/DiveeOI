---
name: coenx-video-explainer-default
description: Produce a calm, accurate 45–90 second software/product explainer with airy typography, restrained motion and truthful UI visuals using coenx-video. Use for product demos, feature walkthroughs, landing-page videos and "how it works" explainers.

metadata:
  category: video
  author: DiveeOI
  version: 1.0.0
  license: MIT
  sourceRepository: https://github.com/Barty-Bart/motion-graphics
  sourceRevision: "3d83d987d658601d8a1269eb691622bdcd427335"
---

# Calm product explainer

Adapted from Barty-Bart's MIT-licensed explainer-default skill. Original source: third_party/motion-graphics/skills/explainer-default/. This version targets DiveeOI's composition API and does not assume HTML/GSAP/Playwright rendering.

## Brief

Use existing user context first. Gather only missing details that change the story: what the product does, the one point to remember, the real features/workflow to demonstrate, brand assets and output format. Default to 60 seconds, 16:9 and a restrained light palette. If the product URL or a repository is provided, inspect it and use exact feature names and current UI wording.

Never invent customer counts, performance numbers, ratings, testimonials, integrations or guarantees. Distinguish real interface captures from illustrative UI. Do not draw fake interface controls and imply they are live product features.

## Story structure

For a 60-second cut:

1. 0–5s: product name and a concrete hook.
2. 5–12s: recognizable user problem or input.
3. 12–48s: three or four short feature chapters, about 9 seconds each.
4. 48–55s: show the coherent workflow/result.
5. 55–60s: name, tagline and a real destination URL if provided.

Shorten to two or three chapters for 45 seconds. Expand to four or five for 90 seconds. Keep the on-screen copy short and give every meaningful statement enough time to read.

## Art direction

Use a warm off-white background, dark ink text and one brand accent. Set type on a consistent grid. Each chapter has one concise title and one large visual demonstration. Use layered card panels and keyframed movement rather than unnecessary scene changes. Avoid stock gradient backgrounds, fake charts and "AI magic" particles.

The source skill uses push-in camera moves and motion blur. coenx-video does not currently expose a camera track for 2D scenes or a native motion-blur filter. Simulate a deliberate crop with composition geometry/keyframed nodes, or keep the shot static and clear. Do not claim camera moves or blur were rendered if they were not.

## UI authenticity

- Best: use user-provided screenshots/assets from the actual product, then label them as captured UI.
- Otherwise rebuild a clearly labelled illustrative UI from confirmed features and exact copy.
- Use supported shapes, text, images, buttons and inputs only. The renderer cannot host arbitrary HTML tables, CSS or a live browser session inside an MP4.
- Do not show cursor clicks that perform actions the product cannot perform.
- Use neutral placeholder content for example rows; do not turn placeholders into factual product claims.

## Authoring and export

Use the parent coenx-video skill for the full pipeline. Compose scene timing in frames, author a low-cost draft, review text/asset fidelity, then render the final MP4. Keep the music bed quiet under narration or on-screen copy; narration is optional and should only be used when it adds information.

Default render profile: balanced. Start review with low. Deliver the MP4 and a note listing the exact features shown and any illustrative UI.
