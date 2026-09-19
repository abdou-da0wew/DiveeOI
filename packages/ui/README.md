# @diveeoi/ui

Shared SolidJS component library. Consumed by `packages/app` via `@diveeoi/ui/*` path mapping with `Kobalte` accessibility primitives, `Shiki` + `marked` markdown, and the `pierre` file viewer.

## Structure

```
src/
  components/          # 197+ presentational components (button, dialog, markdown, diff-changes, tron-typewriter, ...)
  v2/components/       # 81 redesign peers (button-v2, dialog-v2, menu-v2, segmented-control-v2, ...)
  theme/               # ThemeProvider, color utilities, default palettes, v2 overrides
  pierre/              # file viewer subsys (virtualizer, worker, find, runtime, selection-bridge, media)
  context/             # marked, dialog, file
  styles/              # base, colors, theme, utilities, animations, tailwind presets
  hooks/               # shared solid-primitives wrappers
  assets/              # fonts, audio
  i18n/                # ui-scoped translation keys
```

Package exports: `components/*, context/*, hooks/*, styles/*, theme/*, pierre/*` (see `package.json#exports`).

## Components

Thin wrappers over `@kobalte/core` where they exist. For example `src/components/button.tsx` (33 lines) renders `<Kobalte.Button>` with `data-component="button" data-variant/data-size/data-icon` and optional `Icon size="small"`. The attribute surfaces are consumed by Tailwind compound variants rather than prop-driven class toggles.

Notables in `components/`:

- `markdown.tsx` — `marked` + `shiki` (via `markedShiki`) + math (`katex`), highlighted inside `pierre/worker.ts` off the main thread.
- `file.tsx`, `file-icon.tsx` — the browser that `pierre` hydrates.
- `message-part.tsx / message-nav.tsx / shell-submessage.tsx / thinking-heading.tsx / tool-error-card.tsx` — session-level primitives reused by `app/src/pages/session`.
- `diff-changes.tsx`, `line-comment.tsx`, `image-preview.tsx` — review surface that `pierre` and `app/src/context/comments` mount.

V2 components use the same props but a new visual language (`segmented-control-v2`, `tabs-v2`, `textarea-v2` etc.). The migration toggle is `settings.general.newLayoutDesigns()` in `app/src/app.tsx:BodyDesignClass`; new work should prefer `v2` when both variants exist.

## Theme

Single source of truth: `src/theme/context.tsx` (370 lines).

- `ThemeProvider` is a `createSimpleContext` over `themes: Record<string,DesktopTheme>` (with `oc-2` inlined plus `import.meta.glob("./themes/*.json")` for 40 themes), persisted to `localStorage["opencode-theme-id"]`/`opencode-color-scheme`.
- `applyThemeCss(theme, id, mode)` resolves `resolveThemeVariant(theme[mode]) -> themeToCss` and the v2 `resolveThemeVariantV2 -> themeV2ToCss`, caches the concatenated css for the next cold load, and injects `style#oc-theme`:
  ```css
  :root { color-scheme: light|dark; --text-mix-blend-mode: multiply|plus-lighter; <css tokens> <v2> }
  ```
  plus `dataset.theme/colorScheme` and `meta[name=theme-color] = #F8F7F7|#131010`.
- Cross-tab `storage` sync, system `matchMedia("(prefers-color-scheme: dark)")` tracking, `oc-1 -> oc-2` migration, transaction for `previewTheme/previewColorScheme -> commitPreview/cancelPreview`, and `registerTheme(desktopTheme)` for `_opencode/themes` payloads.
- `src/theme/{color.ts, resolve.ts, v2/resolve.ts, types.ts}` carry the token algebra (hex -> `OKLCH` transforms) behind the context.

`DESIGN.md` in this package is a `design-md-extractor` artifact and is asserted as stale in `tests/fixtures/stale-design-md` — treat `context.tsx` as truth and regenerate `DESIGN.md` before relying on it.

## Pierre file viewer

`src/pierre/*`:

- `file-runtime.ts` — content provider that `app/src/context/file` supplies per-directory `tree-store.ts` + `view-cache.ts`.
- `virtualizer.ts` — TanStack virtual core wrapper (expects the very large `solid-virtual` typings patched in `patches/`).
- `worker.ts` — offloads syntax diffs and markdown highlighting to `webWorker`.
- `selection-bridge.ts`, `comment-hover.ts`, `file-selection.ts` — bridge selection and comment hover state between the editor and the React-free `pierre/trees` layer.
- `file-find.ts` (`@ff-labs/fff-bun`) — fast file find used by the dialog `file-tree`.

Non-trivial; read `src/pierre/*` before changing.

## Styling

Tailwind CSS 4.1 via `@tailwindcss/vite`. Base in `src/styles/base.css` (`@import "tailwindcss"`) plus `colors.css, theme.css, utilities.css, animations.css` — consumed as `@diveeoi/ui/index.css` via `app/src/index.css`.

## Scripts

```bash
bun --cwd packages/ui run typecheck
bun --cwd packages/ui run build   # via tsup/tsgo depending on turbo pipeline
```

No dedicated unit tests — exercised through `app` Playwright.
