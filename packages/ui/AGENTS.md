# UI Package (@diveeoi/ui)

Shared UI component library. Contains 197+ components, a v2 redesign system, theme engine, pierre file viewer, and i18n.

- **SolidJS component library** — all components use SolidJS with `createStore` over `createSignal` where possible.
- **197+ components** in `src/components/` — buttons, dialogs, markdown renderer, session review, diff viewer, file browser, etc.
- **V2 redesign** in `src/v2/components/` — 81 parallel components with the `-v2` suffix (`button-v2`, `dialog-v2`, etc.). Migration in progress; check if a v2 variant exists before modifying a v1 component.
- **Pierre file viewer** (`src/pierre/`) — a full code file viewing system with virtualizer, diff selection, comment hover, file find, selection bridge, and web worker. Non-trivial; read `src/pierre/*` before modifying.
- **Theme system** (`src/theme/`) — `ThemeProvider` context, color manipulation, resolver, default light/dark themes, v2 overrides. Colors are manipulated programmatically (not hardcoded).
- **Markdown renderer** (`src/components/markdown.tsx`) — uses `marked` with Shiki syntax highlighting and katex for math. Rendering happens in a web worker (`src/pierre/worker.ts`).
- **Icons** are organized by domain in `src/components/provider-icons/`, `file-icons/`, and `app-icons/`.
- **Styles** — Tailwind CSS 4.1 via Vite plugin. Base styles in `src/styles/`, animations, v2 overrides.
- **i18n** in `src/i18n/` — UI translation strings (separate from app-level i18n).
- **Entry points** in `package.json` exports: components via `@diveeoi/ui/*`, hooks via `@diveeoi/ui/hooks`, context via `@diveeoi/ui/context`, styles via `@diveeoi/ui/styles`, theme via `@diveeoi/ui/theme`, pierre via `@diveeoi/ui/pierre`.
