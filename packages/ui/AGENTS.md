# UI Package (@diveeoi/ui)

Shared SolidJS component library. Contains the primary component set, the parallel v2 component system, theme engine, Pierre file viewer, and i18n.

- **SolidJS component library** — all components use SolidJS with `createStore` over `createSignal` where possible.
- **Primary components** in `src/components/` — buttons, dialogs, markdown renderer, session review, diff viewer, file browser, etc.
- **V2 components** in `src/v2/components/` — parallel component variants with the `-v2` suffix (`button-v2`, `dialog-v2`, etc.). The active layout selector controls which visual system the app uses; check both variants before changing a shared interaction.
- **Pierre file viewer** (`src/pierre/`) — a full code file viewing system with virtualizer, diff selection, comment hover, file find, selection bridge, and web worker. Non-trivial; read `src/pierre/*` before modifying.
- **Theme system** (`src/theme/`) — `ThemeProvider` context, color manipulation, resolver, default light/dark themes, v2 overrides. Colors are manipulated programmatically (not hardcoded).
- **Markdown renderer** (`src/components/markdown.tsx`) — uses `marked` with Shiki syntax highlighting and katex for math. Rendering happens in a web worker (`src/pierre/worker.ts`).
- **Icons** are organized by domain in `src/components/provider-icons/`, `file-icons/`, and `app-icons/`.
- **Styles** — Tailwind CSS 4.1 via Vite plugin. Base styles in `src/styles/`, animations, v2 overrides.
- **i18n** in `src/i18n/` — UI translation strings (separate from app-level i18n).
- **Entry points** in `package.json` exports: components via `@diveeoi/ui/*`, hooks via `@diveeoi/ui/hooks`, context via `@diveeoi/ui/context`, styles via `@diveeoi/ui/styles`, theme via `@diveeoi/ui/theme`, pierre via `@diveeoi/ui/pierre`.

## Current DiveeComposer incident handoff (2026-11-02)

For work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` for the historical incident analysis and `CONTEXT.md` / `RELEASE_HANDOFF_2026-11-06.md` for the current source/runtime and verification boundary. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not infer deployment provenance from the current source HEAD.
