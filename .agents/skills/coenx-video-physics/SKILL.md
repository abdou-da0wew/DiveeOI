---
name: coenx-video-physics
description: Use Coenx's lightweight Rust or TypeScript physics simulation for small interactive scenes, simple collisions, live worlds and explanatory demonstrations.
---

# Lightweight physics scenes

Use physics only when it teaches something or makes the interaction more intuitive. Prefer keyframes for cinematic motion. Physics is suitable for small bounded experiments such as falling objects, bouncing balls, collisions, momentum demonstrations, gas chambers and simple cause-and-effect interactions.

The 2D model uses bodies attached to scene node IDs, position, velocity, size, mass, optional AABB/circle collision, restitution, static bodies and gravity. The Rust sidecar is preferred for batched 2D simulation when available; the TypeScript implementation provides the fallback contract.

## Live 2D physics in interactive worlds

Scenes with `physics` settings run a live frame-stepped world in the interactive player (`src/physics/live.ts`): gravity, mass/restitution, circle/box collisions with positional correction, kinematic drag bodies that follow the pointer and keep a fling velocity on release, and once-per-overlap collision events that dispatch `collide` interactions. `impulse` statements add velocity to live bodies (kicks, thermal agitation); dragging any body node makes it kinematic automatically. Positions use runtime node-center coordinates; poses override node x/y for rendering and hit-testing, so interactive targets track moved bodies.

Design rules for live worlds:

- Give every moving body a node with matching geometry; keep static bodies (`isStatic: true`, `mass: 0`) for walls, floors and chambers.
- Use gravity `[0, 0]` with elastic restitution (0.9+) for gas chambers; use downward gravity and lower restitution for bouncing-ball arenas.
- The player clamps velocity at 4000 px/s and steps at most 12 physics frames per render; validation allows at most 500 2D bodies per scene. Keep counts far below the limits (a 24-molecule gas is already a convincing explainer).
- Collision events fire once per new overlap; a dense fast gas generates many events, so wire only a subset of molecules to `collide` counters if the HUD should stay readable.
- Do not keyframe the same position components that a live body owns — the body wins at runtime.

A proven pattern is the molecules heat chamber: one Heat button whose click trigger fans out into per-molecule interactions (an `impulse` plus a `setNode` color change each) alongside a statement list that increments a temperature state and rewrites the HUD through a `concat` expression; a Cool button reverses both. This teaches temperature as particle motion. The full reference composition lives in `packages/coenx-video/scripts/world-showcase-composition.ts` and runs in the world-showcase e2e.

## 3D physics

For `mesh3d` nodes, `scene.physics3d` uses 3-component gravity and velocity, 3D position and rotation, angular velocity, mass, size and either `aabb` or `sphere` colliders. It supports restitution, friction, fixed substeps and optional axis-aligned world bounds. The TypeScript solver is deterministic and precomputes compact frame poses for the active scene.

Keep 3D body counts at or below the validated limit of 64. Sphere-sphere, sphere-box and AABB-box collisions are supported. Box colliders remain axis-aligned; angular velocity advances Euler rotation but collision impulses do not yet apply angular torque. There are no joints, constraints, cloth, fluids, ragdolls or soft bodies. Use keyframes instead of physics when a shot needs exact cinematic blocking. Do not keyframe the same position/rotation components that the physics body owns.

Keep body counts, simulation durations and update steps within the package's validation and resource limits. Use stable initial conditions and deterministic frame steps. Avoid unlimited simulation loops, high object counts, complex fluid or cloth systems, ragdolls, rigid-body stacks and physically based destruction.

Make the relationship between the physical parameters and the visual outcome clear. Label mass, velocity, gravity or restitution when they matter. Do not imply scientific accuracy beyond the simplified model — the molecules chamber demonstrates trends (heating raises speed and collision rate), not exact thermodynamics. Use real retrieved educational sources for equations and definitions, and keep citations in educational composition provenance.
