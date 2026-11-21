---
name: coenx-video-physics
description: Use Coenx's lightweight Rust or TypeScript physics simulation for small interactive scenes, simple collisions and explanatory demonstrations.
---

# Lightweight physics scenes

Use physics only when it teaches something or makes the interaction more intuitive. Prefer keyframes for cinematic motion. Physics is suitable for small bounded experiments such as falling objects, bouncing balls, collisions, momentum demonstrations and simple cause-and-effect interactions.

The 2D model uses bodies attached to scene node IDs, position, velocity, size, mass, optional AABB/circle collision, restitution, static bodies and gravity. The Rust sidecar is preferred for batched 2D simulation when available; the TypeScript implementation provides the fallback contract.

## 3D physics

For `mesh3d` nodes, `scene.physics3d` uses 3-component gravity and velocity, 3D position and rotation, angular velocity, mass, size and either `aabb` or `sphere` colliders. It supports restitution, friction, fixed substeps and optional axis-aligned world bounds. The TypeScript solver is deterministic and precomputes compact frame poses for the active scene.

Keep 3D body counts at or below the validated limit of 64. Sphere-sphere, sphere-box and AABB-box collisions are supported. Box colliders remain axis-aligned; angular velocity advances Euler rotation but collision impulses do not yet apply angular torque. There are no joints, constraints, cloth, fluids, ragdolls or soft bodies. Use keyframes instead of physics when a shot needs exact cinematic blocking. Do not keyframe the same position/rotation components that the physics body owns.

Keep body counts, simulation durations and update steps within the package's validation and resource limits. Use stable initial conditions and deterministic frame steps. Avoid unlimited simulation loops, high object counts, complex fluid or cloth systems, ragdolls, rigid-body stacks and physically based destruction.

Make the relationship between the physical parameters and the visual outcome clear. Label mass, velocity, gravity or restitution when they matter. Do not imply scientific accuracy beyond the simplified model. Use real retrieved educational sources for equations and definitions, and keep citations in educational composition provenance.
