# brand/

Brand assets and design-process artifacts for the DiveeOI "Mark 02 — Frame +
Cursor" logo. (`docs/PROJECT_MAP.md` describes this directory as logo/favicon
assets.)

## Contents

| Path | What it is |
|---|---|
| `DiveeOI_logo_design_strategy.md` | Design-process transcript/strategy doc (history of how the Mark 02 mark, variants and favicon tiles were produced). |
| `DiveeOI Logo Exploration – Mark 02 Frame + Cursor.html` | Interactive design exploration artboard (standalone HTML). |
| `Mark 02 Frame + Cursor@2x.png` | Rendered logo artwork (2× raster). |
| `Mark 02 Frame + Cursor-html (1)/` | Vendored export of the artboard (HTML + JS support files + its own README). |
| `generated/` | Brand-pipeline raster/SVG favicon outputs in three color variants (`light-*`, `dark-*`, `accent-*`) plus `favicon-accent.svg`, `favicon-dark.svg`, `favicon-light.svg`. |

History: files were added 2026-10-20 (`adcf83e`, then as `Brand/`) and the
directory was renamed to `brand/` on 2026-10-30 (`88c42de`).

## Single-source rule for favicons (IMPORTANT)

**`packages/ui/src/assets/favicon/` is the single source of truth for app
favicons.** Any favicon that the app build/runtime serves (the set consumed by
`packages/ui/src/components/favicon.tsx`, `packages/app/index.html`,
`packages/app/public/`, and `packages/server/src/server/shared/public-ui.ts`)
must live there and only there. **Any new or changed app favicon goes to
`packages/ui/src/assets/favicon/` first**, then is copied to the served
locations by the normal build flow — never the other way round.

`brand/generated/` holds **only brand-pipeline outputs** (the Mark 02 favicon
tiles in the brand palette variants: light/dark/accent, 16–512 px). It is
reference material for the brand pipeline; **it is not consumed by the app
build/runtime** and must not be treated as an app favicon source.

Do not regenerate "copies" of the app favicon set into `brand/generated/`:
byte-identical duplicates of the canonical files were removed from here
(2026-11-22, task 6-d — `favicon.ico`, `dark-180.png`, `dark-96.png`) because
they drifted by definition. Files that genuinely differ from the canonical set
(e.g. `generated/favicon-light.svg`, a differently-serialized variant of the
same drawing) may stay here as brand variants, but the app must never load
them from `brand/`.

To check for accidental re-introduction of duplicates, run the drift checker
from the repo root (manual tool, **not** wired into CI):

```sh
./scripts/check-favicons.sh
```

It fails if any file under `brand/generated/` is byte-identical (sha256) to a
file in `packages/ui/src/assets/favicon/`, and warns about same-named files
that differ (currently `favicon-light.svg` — intentional, see above).
