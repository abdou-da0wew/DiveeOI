---
name: coenx-video-motion-design
description: Plan and author motion design, timing, keyframes, kinetic typography, scene transitions, pacing and camera movement for Coenx videos.
---

# Motion design and timeline

Think in beats, not in a pile of animations. Every movement should reveal hierarchy, explain a relationship, signal an action or move the story forward. Define the purpose of a scene before choosing its animation.

The composition timeline is frame-based. Convert seconds to frames using the composition FPS. Keyframes must increase strictly by frame and stay inside the scene duration. The current easing vocabulary is linear, ease-in, ease-out, ease-in-out and step. Supported animated properties include x, y, width, height, rotation, scaleX, scaleY, opacity and fontSize.

Use anticipation, action, settle and hold. Keep important labels stable long enough to read. Sequence elements with staggered but restrained entrances; avoid moving every object simultaneously. Make transitions carry meaning, such as moving from a system overview into one selected component.

The current scene transitions are fade, slide-left and slide-right. The current 3D camera and mesh facilities are intentionally lightweight. Do not describe them as full 3D compositing, physically based lighting, depth of field, shader effects or a general game engine.

Avoid frame-by-frame procedural scripts. Express motion through serializable keyframe data so MP4 rendering is deterministic and interactive playback can seek accurately. Use physics only when motion is genuinely physical and the scene stays within the resource budget.\n