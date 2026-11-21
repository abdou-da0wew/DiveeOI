---
name: coenx-video-motion-broll
description: Turn a supplied transcript or SRT into a timed plan of code-authored motion-graphic cutaways and callout clips. Use when a creator wants animated B-roll, visual emphasis or explanatory inserts aligned to spoken words.

metadata:
  category: video
  author: DiveeOI
  version: 1.0.0
  license: MIT
  sourceRepository: https://github.com/Barty-Bart/motion-graphics
  sourceRevision: "3d83d987d658601d8a1269eb691622bdcd427335"
---

# Transcript-led motion-graphic B-roll

Adapted from Barty-Bart's MIT-licensed motion-broll skill. See third_party/motion-graphics/skills/motion-broll/ for the original scripts, HTML examples, engine references and font notices.

## Inputs and analysis

Use a supplied video and transcript/SRT. Inspect media metadata with ffprobe and parse the timecodes. Do not upload private footage or transcripts to an external service. If only a transcript is supplied, plan from its timings; do not estimate word-level alignment beyond what is provided without marking it approximate.

Plan clips around a meaningful phrase, not every noun. For every insert, record:

- Source in/out time.
- Transcript line or exact phrase covered.
- Visual concept and why it clarifies the spoken point.
- Output duration and aspect ratio.
- Whether the insert is a standalone cutaway or a callout asset.

Avoid invented numbers. Charts use only numbers supplied by the user or a cited source. If no real data exists, use relative, clearly illustrative shapes without labels that look factual.

## Coenx output boundary

Current coenx-video renders standalone compositions to MP4. It does not yet accept an arbitrary source-video clip as a node, composite a B-roll track over source footage, or export transparent ProRes overlays. Do not claim that it has replaced the source video or made an alpha panel.

Deliver separate, timestamped motion-graphic cutaway MP4s plus a timing sheet (for example TIMING.md) that a video editor can place on the source timeline. If the user specifically needs compositing into the original source, explain that this integration is not implemented and keep the files as standalone inserts.

## Visual grammar

Prefer one continuous graphic idea per cutaway: a shape becomes a card, a card becomes a chart, or a real term becomes a labelled diagram. Keep the animation seek-safe: the frame is a deterministic function of frame index, and no unseeded random state is used. Use a small number of consistent colors and large typography.

The current engine supports rects, ellipses, lines, text, images, keyframes and basic transitions. For path morphs, motion blur, arbitrary masks, or transparent compositing, simplify or use an explicitly prepared local asset. Never silently install a different renderer.

## Review

Check each insert at its exact duration and at the moment it covers the spoken line. Make sure it does not obscure a face, subtitle or other critical content in the source. Deliver all MP4 insert paths and the timing sheet, with source-time assumptions documented.
