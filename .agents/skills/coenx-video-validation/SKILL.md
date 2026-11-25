---
name: coenx-video-validation
description: Validate Coenx composition data and source files, test interactions, inspect outputs and catch rendering defects before delivery.
---

# Coenx validation and review

Validate all three source files before rendering. Reject unsupported elements, properties, selectors, event triggers, action names, expression operators, invalid references and unsafe asset paths rather than silently ignoring them.

Check that scene IDs and node IDs are unique, keyframes increase strictly, timers stay within the scene timeline, all referenced audio tracks and target nodes exist, and all local media paths resolve within the project root. Check font names against the bundled font catalogue. For effect chains, verify the budget rules: at most 4 effects per node, blur sigma 0..64, drop-shadow sigma 0..32 with offsets within +/-128, color-adjust amounts 0..4 and hueRotate within +/-360, and the 8,388,608-pixel padded temporary-surface cap; mesh3d nodes must not carry effects.

For standard MP4, render a low-cost draft, inspect frames at the beginning, middle, transitions and end, then verify codec, dimensions, frame rate, duration and audio streams with ffprobe. Do not trust a successful process exit alone.

For interactive exports, verify the generated index, composition, player runtime, assets, fonts and manifest. Exercise every control and feedback path. Check keyboard input and viewport resizing. Confirm the project loads with the network disabled when all supplied media is local.

Educational output must include a learning objective and actual retrieval citations. Verify visible sources, scientific accuracy, question wording and feedback. Never report that an interactive test, audio render, or browser QA succeeded unless it was actually run.

Keep render concurrency and memory within the selected render profile. Preserve user source files, do not overwrite output folders silently and remove only temporary files created by the current render.\n
## AI tool preflight

When running inside DiveeOI, use the canonical `coenx_video_capabilities` tool to check output/backend support and `coenx_video_validate` to compile and validate complete CML or JSON source before rendering. The validation tool returns structured error diagnostics and a frame/node summary; it does not inspect local files or render frames. For renderer-specific behavior, consult the `coenx-video-rendering` skill and the machine-readable capability matrix rather than treating successful composition validation as proof that every renderer supports every node.
