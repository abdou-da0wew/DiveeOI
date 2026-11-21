# coenx-video package guide

- This is the shared code-authored video engine for the general agent and Targeted Learning.
- Keep the composition model serializable and versioned. Interactive logic is a validated AST; never use `eval`, `Function`, or execute strings from a compiled project.
- Standard MP4 rendering and interactive playback share the same composition, timeline, scene geometry, and audio clip model, but have separate output pipelines.
- The standard renderer is deterministic and frame-addressable. Use bounded frame batches, a single active render by default, capped native threads, and an abort signal.
- Interactive playback must remain responsive on low-end devices: cap device pixel ratio and frame rate, defer media decoding, and pause when hidden.
- Keep Rust for repeated physics simulation and other measured hot loops. Keep TypeScript for authoring, validation, orchestration, and DOM/input behavior. A TypeScript fallback must preserve the same physics contract.
- Native sidecars communicate over newline-delimited JSON. Never log protocol output to stdout.
- Do not download media implicitly. Resolve local assets within the project root; remote URLs require an explicit user-supplied media workflow.
- Keep source files below 300 lines. Split schemas, timeline, runtime, renderers, physics, CLI, and adapters into separate modules.
- Run `bun test` and `bun run typecheck` in this package. Run native `cargo fmt --check`, `cargo test --offline`, and `cargo clippy --offline -- -D warnings` when changing Rust.
