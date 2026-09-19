# @diveeoi/identity

Brand assets for DiveeOI. Distributes logos, wordmarks, icons, and Chrome/Safari web assets as plain files — no code, no dependencies.

## Contents

```
src/
  logo.svg / logo-light.svg / logo-dark.svg
  wordmark.svg
  favicon.svg
  icons/   96x96, 192x192, 512x512 PNGs (+ @2x), mark light/dark
  chrome/  manifest-adjacent assets
  fonts/   vendored display fonts (see LICENSE bundled)
```

## Use

Direct file URL (Vite / asset imports):

```ts
import logo from "@diveeoi/identity/logo.svg"
```

Or via static serve (the UI serves `src/server/shared/ui.ts` assets through the same `serveUIEffect` static handler):

```html
<link rel="icon" href="/favicon.svg" />
```

## Theme integration

`packages/ui/src/theme/context.tsx:registerTheme` and `packages/app/src/app.tsx:_ExternalThemeLoader` accept assets from here (the dark swatch `meta[name=theme-color] = #131010` is paired with the dark mark).

## Not a dependency for `server` or `db`

Listed only where needed (`app`, `ui`). Keep raster variants committed (no on-the-fly resizing in CI) and don't introduce sips/gets outside `src/` without a maintainer review — binary bloat grows quickly.

## Scripts

No `typecheck` or tests. Build is a file copy.

```bash
ls packages/identity/src
```
