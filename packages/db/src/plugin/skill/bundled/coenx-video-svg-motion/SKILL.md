---
name: coenx-video-svg-motion
description: Create clean vector motion graphics and SVG-backed animated scenes with Coenx nodes, keyframes, geometry, transitions and low-cost Canvas playback.
---

# SVG and vector motion system

The standard renderer serializes scene geometry to SVG frames before rasterization and MP4 encoding. Interactive playback paints the shared visual-node model on Canvas by default, with an SVG stage option for crisp vector output and inspectable SVG nodes. Both modes use the same composition model and frame-based timeline.

Use rect, ellipse, line and text for vector scenes. Use polylines for simple diagrams and chart traces. Use image nodes for supplied SVG or raster assets only when the asset is user-provided or otherwise approved and kept within the project asset boundary. The current public node API does not expose arbitrary path d data, clip paths, masks, SVG filters, embedded HTML or a full SVG DOM.

Build vector scenes from a small set of reusable visual roles: background, primary subject, supporting geometry, labels and controls. Use a consistent stroke scale and alignment grid. Keep the number of points in a polyline bounded, avoid needless overdraw, and use stable shapes rather than redrawing complex geometry every frame.

Animate supported numeric properties with keyframes and easing. Use opacity, position, dimensions, rotation and scale to create deliberate entrances, emphasis and exits. Keep a readable hold after each meaningful transformation. Avoid using constant movement as decoration.

Use the same scene model for MP4, interactive Canvas and interactive SVG exports. Check both outputs when the scene includes text, images or input controls. Do not promise identical SVG/Canvas pixel output or unsupported SVG filters. Prefer supported primitives over custom markup that the renderer would have to ignore.\n
