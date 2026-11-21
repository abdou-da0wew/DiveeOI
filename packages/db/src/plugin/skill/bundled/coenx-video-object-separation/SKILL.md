---
name: coenx-video-object-separation
description: Separate a foreground person, product or hand from supplied footage into a local matte/asset for later compositing. Use only when the user explicitly asks for segmentation or a foreground cut-out and local resources are adequate.

metadata:
  category: video
  author: DiveeOI
  version: 1.0.0
  license: MIT
  sourceRepository: https://github.com/Barty-Bart/motion-graphics
  sourceRevision: "3d83d987d658601d8a1269eb691622bdcd427335"
---

# Local foreground extraction (optional)

Adapted from the object-separation skill in Barty-Bart's MIT-licensed motion-graphics repository. Source implementation, setup, model notes and licenses are kept in third_party/motion-graphics/skills/object-separation/.

This is an optional preprocessing stage, not part of the default coenx render runtime. The upstream approach uses SAM 2.1 for local segmentation. Model weights and Python dependencies may be large; do not install or download them automatically.

## Before running

1. Confirm the user requested foreground separation, rather than assuming every video needs a cut-out.
2. Inspect free disk space, system RAM, available GPU/runtime and input video dimensions/duration.
3. Explain that CPU processing can be slow and that segmentation quality depends on motion, occlusion and background.
4. Ask before downloading model weights or creating a large environment. Keep model files in a project-local cache that can be removed.
5. Work on a copy of the source. Never overwrite the original video.

## Resource defaults

For a machine with limited memory or no GPU:

- Generate a low-resolution proxy no larger than 720p.
- Sample at a conservative rate (start around 4–8 frames/second) rather than segmenting every source frame.
- Process short chunks, reuse the previous mask as guidance only if the upstream implementation supports it, and release model memory after each chunk.
- Stop cleanly on cancellation and remove incomplete outputs.
- Do not exceed a user-approved disk budget; retain only the final matte and requested intermediates.

Increase temporal density or resolution only when edge quality visibly requires it and the user's machine can support it. Do not run segmentation concurrently with a video render.

## Output and limitation

Export a matte or extracted foreground asset with a clear naming convention and retain the source timebase. The current coenx-video composition API does not include alpha-video compositing or a segmentation model; extracted mattes are preprocessing assets for a downstream editor/renderer. Do not promise transparent ProRes composition through coenx-video until that pipeline is implemented.

Do not send private source video or frame crops to remote inference services unless the user explicitly requests and approves that processing.
