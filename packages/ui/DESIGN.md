---
version: alpha
name: DiveeOI Design System (v2)
system: diveeoi-v2
description: >
  Design system for the DiveeOI web application — a fork of OpenCode that
  extracts web UI and server components. This document describes the v2
  redesign, a parallel system being adopted across the UI library.
---

# DiveeOI Design System (v2)

## Overview

DiveeOI is a code assistant platform (fork of OpenCode) whose UI is built with
SolidJS, Kobalte headless primitives, Tailwind CSS 4.1, and a custom CSS custom
property theme engine. The v2 design system introduces a streamlined, accessible
aesthetic with a reduced color set, consistent elevation model, and improved
typographic rhythm.

Key principles:
- **Accessible by default**: all components ship with ARIA attributes from
  Kobalte, focus-visible outlines, and sufficient color contrast.
- **Declarative styling**: components use `data-component`/`data-variant`/`data-size`
  attribute selectors for CSS targeting — no BEM, no utility soup in markup.
- **Two color schemes**: light and dark mode via `[data-color-scheme]` attribute
  on a root element. No `prefers-color-scheme` media query in v2.
- **Pattern-first**: small set of reusable tokens (grey scale, alpha overlays,
  elevation layers) compose into every component.

## Colors

### Named palette

A 12-step scale (100–1200, lightest to darkest) for each hue. Steps 100–400 are
light tints, 500–700 are vibrants, 800–1200 are deep shades.

| Family | 100 | 300 | 500 | 600 (base) | 700 | 800 | 1100 |
|---|---|---|---|---|---|---|---|
| Grey | {token.v2-grey-100} `#fafafa` | {token.v2-grey-300} `#eeeeee` | {token.v2-grey-500} `#aeaeae` | {token.v2-grey-600} `#808080` | {token.v2-grey-700} `#5c5c5c` | {token.v2-grey-800} `#3a3a3a` | {token.v2-grey-1100} `#161616` |
| Red | {token.v2-red-100} `#fceceb` | {token.v2-red-300} `#f2bbb7` | {token.v2-red-500} `#f17471` | {token.v2-red-600} `#f1484f` | {token.v2-red-700} `#d92e3c` | {token.v2-red-800} `#b82d35` | {token.v2-red-1100} `#5f1a1c` |
| Orange | {token.v2-orange-100} `#fdf2ed` | {token.v2-orange-300} `#ffd8c6` | {token.v2-orange-500} `#ffa478` | {token.v2-orange-600} `#ff8648` | {token.v2-orange-700} `#ee7330` | {token.v2-orange-800} `#d16427` | {token.v2-orange-1100} `#723d22` |
| Yellow | {token.v2-yellow-100} `#fefaec` | {token.v2-yellow-300} `#f7e5b5` | {token.v2-yellow-500} `#f2cf76` | {token.v2-yellow-600} `#f6c251` | {token.v2-yellow-700} `#e7af36` | {token.v2-yellow-800} `#cb9f34` | {token.v2-yellow-1100} `#68552b` |
| Green | {token.v2-green-100} `#e7f9ea` | {token.v2-green-300} `#b8e9c1` | {token.v2-green-500} `#6bd586` | {token.v2-green-600} `#49c970` | {token.v2-green-700} `#2eaf5a` | {token.v2-green-800} `#198b43` | {token.v2-green-1100} `#164c26` |
| Cyan | {token.v2-cyan-100} `#e2f7fb` | {token.v2-cyan-300} `#a3e4ef` | {token.v2-cyan-500} `#00c5df` | {token.v2-cyan-600} `#00abcf` | {token.v2-cyan-700} `#0096b8` | {token.v2-cyan-800} `#007d9b` | {token.v2-cyan-1100} `#004756` |
| Blue | {token.v2-blue-100} `#ecf1fe` | {token.v2-blue-300} `#c3d4fd` | {token.v2-blue-500} `#7698fd` | {token.v2-blue-600} `#3b5cf6` | {token.v2-blue-700} `#3250df` | {token.v2-blue-800} `#2c47c8` | {token.v2-blue-1100} `#1c2e70` |
| Purple | {token.v2-purple-100} `#ebecfe` | {token.v2-purple-300} `#b9b8f5` | {token.v2-purple-500} `#8271f8` | {token.v2-purple-600} `#7152f4` | {token.v2-purple-700} `#623be2` | {token.v2-purple-800} `#5230c2` | {token.v2-purple-1100} `#2b1b6a` |
| Pink | {token.v2-pink-100} `#fdecf3` | {token.v2-pink-300} `#fabcd8` | {token.v2-pink-500} `#f26cb2` | {token.v2-pink-600} `#f64aab` | {token.v2-pink-700} `#e4429e` | {token.v2-pink-800} `#c83d8b` | {token.v2-pink-1100} `#6f284f` |

### Alpha overlays

Used for borders, overlays, scrims, and hover/pressed states. Dark alpha overlays
use `#000000` with varying opacity; light alpha overlays use `#ffffff`.

| Token | Opacity | Usage |
|---|---|---|
| {token.v2-alpha-dark-4} | 2.5% | Overlay hover, light elevation layer |
| {token.v2-alpha-dark-8} | 5% | Overlay pressed, muted border, elevation mid layer |
| {token.v2-alpha-dark-10} | 6.25% | Border base |
| {token.v2-alpha-dark-12} | 7.5% | Elevation border layer |
| {token.v2-alpha-dark-14} | 8% | Button neutral border |
| {token.v2-alpha-dark-20} | 12.5% | Border strong |
| {token.v2-alpha-dark-40} | 25% | Scrim overlay |
| {token.v2-alpha-dark-60} | 37.5% | Shadows |
| {token.v2-alpha-light-8} | 5% | Dark mode muted border |
| {token.v2-alpha-light-10} | 6.25% | Dark mode border base |
| {token.v2-alpha-light-12} | 7.5% | Contrast hover |
| {token.v2-alpha-light-16} | 8.6% | Dark mode elevation border |
| {token.v2-alpha-light-20} | 12.5% | Dark mode border strong, contrast gradient |
| {token.v2-alpha-light-24} | 14% | Contrast pressed |
| {token.v2-alpha-light-30} | 19% | Dark mode scrim |
| {token.v2-alpha-light-40} | 25% | Dark mode shadow |

### Semantic tokens

#### Background

| Token | Light | Dark | Usage |
|---|---|---|---|
| {token.v2-background-bg-base} | `#ffffff` | `#161616` | Page / app background |
| {token.v2-background-bg-deep} | `#fafafa` | `#080808` | Deeper background areas |
| {token.v2-background-bg-layer-01} | `#fafafa` | `#242424` | Card / surface layer 1 |
| {token.v2-background-bg-layer-02} | `#f2f2f2` | `#2e2e2e` | Nested surface layer 2 |
| {token.v2-background-bg-layer-03} | `#eeeeee` | `#3a3a3a` | Nested surface layer 3 |
| {token.v2-background-bg-layer-04} | `#dbdbdb` | `#5c5c5c` | Deepest surface layer |
| {token.v2-background-bg-inverse} | `#161616` | `#fafafa` | Inverse background |
| {token.v2-background-bg-contrast} | `#242424` | `#5c5c5c` | Contrast button base |
| {token.v2-background-bg-button-neutral} | `#ffffff` | `alpha-light-6` | Neutral button base |
| {token.v2-background-bg-accent} | `#3b5cf6` | `#3b5cf6` | Accent / interactive surface |

#### Text

| Token | Light | Dark | Usage |
|---|---|---|---|
| {token.v2-text-text-base} | `#161616` | `#f2f2f2` | Primary body text |
| {token.v2-text-text-muted} | `#5c5c5c` | `#aeaeae` | Secondary / muted text |
| {token.v2-text-text-faint} | `#808080` | `#808080` | Tertiary / faint text |
| {token.v2-text-text-inverse} | `#ffffff` | `#242424` | Text on dark backgrounds |
| {token.v2-text-text-contrast} | `#ffffff` | `#f2f2f2` | Text on contrast buttons |
| {token.v2-text-text-accent} | `#3b5cf6` | `#7698fd` | Interactive / link text |
| {token.v2-text-text-accent-hover} | `#3250df` | `#c3d4fd` | Hovered interactive text |

#### Icon

| Token | Light | Dark | Usage |
|---|---|---|---|
| {token.v2-icon-icon-base} | `#3a3a3a` | `#dbdbdb` | Primary icons |
| {token.v2-icon-icon-muted} | `#808080` | `#808080` | Muted / secondary icons |
| {token.v2-icon-icon-inverse} | `#ffffff` | `#242424` | Icons on dark backgrounds |
| {token.v2-icon-icon-contrast} | `#fafafa` | `#f2f2f2` | Icons on contrast buttons |
| {token.v2-icon-icon-accent} | `#3b5cf6` | `#7698fd` | Interactive icon color |
| {token.v2-icon-icon-accent-hover} | `#3250df` | `#c3d4fd` | Hovered interactive icon |

#### Border

| Token | Light | Dark | Usage |
|---|---|---|---|
| {token.v2-border-border-muted} | `alpha-dark-8` | `alpha-light-8` | Subtle separators |
| {token.v2-border-border-base} | `alpha-dark-10` | `alpha-light-10` | Default borders |
| {token.v2-border-border-strong} | `alpha-dark-20` | `alpha-light-20` | Emphasis borders |
| {token.v2-border-border-inverse} | `#242424` | `#fafafa` | Borders on light backgrounds |
| {token.v2-border-border-focus} | `#7698fd` | `#7698fd` | Focus ring outline |

#### State (Success / Warning / Danger / Info)

| Token | Light bg | Light fg | Light border | Dark bg | Dark fg | Dark border |
|---|---|---|---|---|---|---|
| Success | `#e7f9ea` | `#198b43` | `#b8e9c1` | `#14361d` | `#6bd586` | `#1d783c` |
| Warning | `#fefaec` | `#cb9f34` | `#f7e5b5` | `#4b4025` | `#f2cf76` | `#ac8833` |
| Danger | `#fceceb` | `#b82d35` | `#f2bbb7` | `#461516` | `#f17471` | `#97252b` |
| Info | `#ecf1fe` | `#2c47c8` | `#c3d4fd` | `#1b2852` | `#7698fd` | `#263fa9` |

#### Avatar (fixed colors, theme-independent)

9 colors with matching background and border. Foreground is always `#ffffff`.

| Color | Background | Border |
|---|---|---|
| Orange | `#ee7330` | `#d16427` |
| Yellow | `#e7af36` | `#cb9f34` |
| Cyan | `#0096b8` | `#007d9b` |
| Green | `#2eaf5a` | `#198b43` |
| Red | `#d92e3c` | `#b82d35` |
| Pink | `#e4429e` | `#c83d8b` |
| Blue | `#3250df` | `#2c47c8` |
| Purple | `#623be2` | `#5230c2` |
| Gray | `#5c5c5c` | `#3a3a3a` |

#### Illustration (3-layer depth)

| Token | Light | Dark |
|---|---|---|
| Layer 01 (front) | `#eeeeee` | `#2e2e2e` |
| Layer 02 (mid) | `#dbdbdb` | `#3a3a3a` |
| Layer 03 (back) | `#aeaeae` | `#5c5c5c` |

## Typography

### Font family

V2 uses `"Inter"` as its primary sans-serif font, with a system font fallback
chain. Inter is expected to be loaded externally (not bundled).

```css
--font-family-text: "Inter", sans-serif;
--v2-font-family-sans: "Inter", sans-serif;
```

### Type scale

| Token / Class | Size | Weight | Line height | Letter spacing | Usage |
|---|---|---|---|---|---|
| Tag / badge | 11px | 530 (semibold) | 1 | +0.05px | Badges, tags, labels |
| Button, small text | 13px | 530 (semibold) | 1 | -0.04px | Buttons (all variants), small labels |
| Description text | 13px | 440 (regular) | 1 | -0.04px | Dialog description, secondary text |
| `.text-12-regular` | 13px | 400 | 150% | 0 | Utility: small body text |
| `.text-12-medium` | 13px | 500 | 150% | 0 | Utility: medium small text |
| `.text-14-regular` | 14px | 400 | 180% | 0 | Utility: body text |
| `.text-14-medium` | 14px | 500 | 150% | 0 | Utility: medium body text |
| Dialog title | 15px | 530 (semibold) | 100% | -0.13px | Modal/dialog titles |
| `.text-16-medium` | 16px | 500 | 150% | -0.16px | Section headings |
| `.text-20-medium` | 20px | 500 | 120% | -0.32px | Page titles |

### Font features

- All text uses `font-variant-numeric: tabular-nums` for aligned numerals.
- Text rendering is set to `geometricPrecision` with `-webkit-font-smoothing: antialiased`
  at the root level (applied via the Button CSS global selector).
- Monospace stack: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
  "Liberation Mono", "Courier New", monospace` (used in code rendering, not
  part of v2 component library directly).

## Layout & Spacing

### Spacing primitives

The base unit is `0.25rem` (4px). Components use explicit pixel values in their
CSS rather than a rigid 4px grid, but values tend to cluster around multiples of
1–2px:

| Use case | Value |
|---|---|
| Button padding X (small) | 0–9px |
| Button padding X (normal) | 0–11px |
| Button padding X (large) | 0–15px |
| Dialog header padding | 16px |
| Dialog footer padding | 16px |
| Dialog gap (header/body/footer) | 8px |
| Dialog title-to-description gap | 8px |
| Button icon-to-text gap | 6px |
| Tag icon-to-text gap | 4px |
| Component border radius | 2px / 4px / 6px |

### Sizing system

Components expose a `size` prop with a consistent set of options:

| Size | Height | Border radius | Usage |
|---|---|---|---|
| `small` | 24px | 4px | Compact buttons, inline controls |
| `normal` / `base` | 28px | 6px | Default buttons, text inputs |
| `large` | 32px | 6px | Primary actions, prominent inputs |

Dialog containers use width-based sizing:

| Size | Width | Height |
|---|---|---|
| `normal` | 480px | 368px |
| `large` | 640px | 480px |
| `x-large` | 800px | 560px |

### Container patterns

- **Buttons**: `inline-flex` with centered content
- **Dialogs**: `fixed` with `flex` centering, scrim overlay via `inset: 0`
- **Tags**: `inline-flex` with centered content
- **Avatars**: `inline-flex` with centered fallback text
- **Text inputs**: `inline-flex` with decorated wrapper

## Elevation & Depth

V2 uses a composable elevation model built from layered alpha shadows and a
0.5px border "glint". Each elevation token bundles up to 4 shadow layers:

| Token | Layers | Typical use |
|---|---|---|
| `raised` | 2 soft directional + 1 micro border | Cards, panels |
| `floating` | 2 medium directional + 1 micro border | Dropdowns, popovers |
| `overlay` | 2 strong directional + 1 micro border | Modals, dialogs |
| `button-neutral` | 1 subtle directional + 1 micro border | Neutral button default |
| `button-contrast` | 1 directional + 1 border + 2 inset highlights | Contrast button default |
| `elements` | 1 tight micro shadow | Small elements |
| `switch-off` | 3 inset shadows | Switch off state |
| `switch-on` | 3 inset shadows | Switch on state |

### Light mode examples

```css
--v2-elevation-raised:
  0px 2px 4px 0px rgba(0,0,0,0.025),
  0px 1px 2px -1px rgba(0,0,0,0.05),
  0px 0px 0px 0.5px rgba(0,0,0,0.075);

--v2-elevation-floating:
  0px 8px 16px 0px rgba(0,0,0,0.025),
  0px 4px 8px 0px rgba(0,0,0,0.05),
  0px 0px 0px 0.5px rgba(0,0,0,0.075);

--v2-elevation-overlay:
  0px 16px 32px 0px rgba(0,0,0,0.025),
  0px 8px 16px 0px rgba(0,0,0,0.05),
  0px 0px 0px 0.5px rgba(0,0,0,0.075);
```

### Dark mode

Dark mode uses stronger shadow opacity (up to `alpha-dark-30` / 19%) and adds an
inverted edge highlight (`0px -0.5px 0px 0px var(--v2-alpha-light-6)`) to
simulate rim lighting on raised surfaces.

## Shapes

### Border radius

| Token | Value | Usage |
|---|---|---|
| `--radius-xs` (via CSS) | 2px | Tags, badges, small indicators |
| `--radius-sm` (via CSS) | 4px | Small buttons, icon buttons, close button |
| `--radius-md` (via CSS) | 6px | Buttons (normal/large), dialogs, inputs |

### Border width

All borders use `0.5px` (sub-pixel) widths applied via `box-shadow` or explicit
`border: 0.5px solid`. Focus outlines use `2px` with `2.5px` offset.

### Focus style

```css
outline: 2px solid var(--v2-border-border-focus);  /* #7698fd */
outline-offset: 2.5px;
```

Applied via `:focus-visible` pseudo-class on interactive elements. Buttons and
inputs never show focus ring on `:focus` (only `:focus-visible` or
`[data-state="focus"]`).

## Components

### Button (`ButtonV2`)

| Prop | Values |
|---|---|
| `variant` | `neutral` (default), `contrast`, `ghost`, `ghost-muted` |
| `size` | `small` (24px), `normal` (28px, default), `large` (32px) |
| `icon` | Optional icon name from the icon sprite |
| `children` | Label text |

**Variants:**

| Variant | Background | Text color | Shadow |
|---|---|---|---|
| `neutral` | `bg-button-neutral` | `text-base` | `elevation-button-neutral` |
| `contrast` | `bg-contrast` + gradient overlay | `text-contrast` | `elevation-button-contrast` |
| `ghost` | transparent | `text-base` | none |
| `ghost-muted` | transparent | `text-muted` | none |

Hover uses overlay layer on top of the base. Disabled state sets `opacity: 0.5`
(or 0.4 for contrast) with `cursor: not-allowed`.

### Dialog (`Dialog`)

| Prop | Values |
|---|---|
| `size` | `normal` (480x368px), `large` (640x480px), `x-large` (800x560px) |
| `variant` | `default`, `settings` |
| `fit` | Boolean — container height auto-sizes to content |
| `title` | Optional heading |
| `description` | Optional subtitle |
| `action` | Optional action element (e.g. Button) |

Structure:
1. **Overlay**: fixed `inset: 0`, `z-index: 50`, scrim `alpha-dark-40`
2. **Container**: centered via flex, `bg-layer-01`, `elevation-overlay`, 6px radius
3. **Header**: 16px padding, title (15px/530) + description (13px/440), close button
4. **Body**: flex-1, overflow hidden
5. **Footer** (`DialogFooter`): `flex justify-end`, 16px padding, 8px gap

### Tag / Badge (`Tag`)

Renders as `<span data-component="tag">`. Fixed 16px height, 0–4px padding,
2px border radius, 0.5px border, 11px/530 font. Optional
`data-high-contrast` attribute for stronger border.

### Switch (`Switch`)

Uses Kobalte Switch primitive. Structure:
- `data-component="switch"` on root
- `data-slot="switch-input"` — hidden input
- `data-slot="switch-label"` — label text (supports `sr-only`)
- `data-slot="switch-control"` — visual track
- `data-slot="switch-thumb"` — knob
- `data-slot="switch-error"` — error message

Elevation: `elevation-switch-off` / `elevation-switch-on` for the track.

### Text Input (`TextInputV2`)

| Prop | Values |
|---|---|
| `appearance` | `base` (28px tall), `large` (32px tall) |
| `numeric` | Boolean — enables tabular numerals |
| `invalid` | Boolean — error styling |
| `showCopyButton` | Boolean — trailing copy icon |
| `disabled` | Boolean |

Structure: wrapper `div[data-component="text-input-v2"]` containing value area
and optional copy button. Uses `data-invalid` / `data-disabled` / `data-numeric`
attribute selectors for CSS styling.

### Avatar (`Avatar`)

| Prop | Values |
|---|---|
| `fallback` | String to derive first grapheme |
| `size` | `small`, `normal`, `large` (default) |
| `kind` | `user`, `org` |
| `src` | Optional image URL |
| `background` | Custom background (when no image) |
| `foreground` | Custom foreground (when no image) |

When no `src` provided, renders the first grapheme of `fallback` centered,
using `--avatar-bg` and `--avatar-fg` custom properties for coloring.

### Tabs (`TabsV2`)

| Prop | Values |
|---|---|
| `variant` | `normal` (default), `pill`, `settings` |
| `orientation` | `horizontal` (default), `vertical` |

Sub-components: `TabsV2.List`, `TabsV2.Trigger` (with optional `subtext` and
`onMiddleClick`), `TabsV2.Content`, `TabsV2.CloseButton`, `TabsV2.SectionTitle`.

### Icon (`Icon`)

Inline SVG sprite system with 106 named icons (kebab-case). Icons are defined as
path data in a `icons` map and rendered via `<symbol>` elements in a hidden
sprite. Color is inherited from `currentColor`.

## Motion

### Animations

| Token / Class | Definition | Usage |
|---|---|---|
| `--animate-pulse` | `pulse-opacity 2s ease-in-out infinite` | Loading states |
| `--animate-pulse-scale` | `pulse-scale 1.2s ease-in-out infinite` | Pulsing scale |
| `.fade-up-text` | `fadeUp 0.4s ease-out forwards` with staggered delays | Text entrance |

### Keyframes

| Name | Description |
|---|---|
| `pulse-opacity` | 40% → 100% → 40% opacity |
| `pulse-scale` | scale(1) → scale(0.667) → scale(1) |
| `pulse-opacity-dim` | 15% → 35% → 15% opacity |
| `fadeUp` | translateY(5px) + 0 opacity → translateY(0) + opacity 1 |

## Do's & Don'ts

### Do's

1. **Do use semantic tokens over raw hex values.**
   Always reference `var(--v2-text-text-base)` instead of `#161616`. The theme
   engine remaps tokens per color scheme — raw hex values break dark mode.

2. **Do prefer `data-*` attribute selectors over Tailwind utility classes in
   component CSS.**
   Components use `data-component`, `data-variant`, `data-size`, and
   `data-slot` selectors for their core styles. Use Tailwind utilities only for
   one-off adjustments (like `inline-flex items-center gap-2` in compound
   sub-components).

3. **Do set `data-color-scheme` on a root element for dark mode.**
   V2 uses `[data-color-scheme="dark"]` to trigger dark overrides. Do not rely
   on `prefers-color-scheme` unless migrating legacy code.

4. **Do use the elevation tokens for all surface layering.**
   `elevation-raised` / `elevation-floating` / `elevation-overlay` encode the
   entire shadow + border glint system. Hand-authored box-shadows will not
   match the system's visual language.

5. **Do apply `opacity` to disabled interactive elements.**
   Button disabled states use `opacity: 0.5` (neutral/ghost) or `0.4` (contrast).
   Do not change the background color — dimming via opacity preserves the
   variant's character.

6. **Do use the 0.5px border "glint" pattern for all surface separations.**
   Modeled as a `box-shadow` layer with `var(--v2-alpha-dark-12)` or similar,
   not as a separate `border` property. This keeps borders consistent across
   raised, floating, and overlay elevations.

7. **Do match button heights to the size system (24/28/32px).**
   These map directly to `small` / `normal` / `large`. Custom heights break the
   rhythmic alignment of adjacent controls.

8. **Do use the `text-muted` and `text-faint` tokens for secondary content.**
   `text-base` is for primary body copy. Muting via opacity or a lighter grey
   scale ensures hierarchy without guessing.

9. **Do use `font-weight: 530` for semibold labels.**
   This is the CSS "semibold" weight across the v2 system. It sits between the
   JavaScript font-weight spectrum's 500 and 600 values, intentionally chosen
   for Inter's axis.

10. **Do keep avatar colors theme-independent.**
    Avatar background/border pairs are defined as fixed hex values, not semantic
    tokens. This ensures avatars remain identifiable regardless of the active
    color scheme.

### Don'ts

1. **Don't hardcode border-radius values other than 2px, 4px, or 6px.**
   These three values are the system's complete radius vocabulary. Adding random
   radii (8px, 12px, rounded-full) breaks visual consistency.

2. **Don't use BEM, CSS Modules, or styled-components for new v2 components.**
   V2 styling targets `data-component` / `data-slot` attribute selectors in
   co-located `.css` files. Other approaches are for v1 migration only.

3. **Don't add new color families without updating the palette.**
   The named palette is intentionally limited to 9 hues. Adding a new hue
   (teal, indigo, lime) without updating this document will cause token drift.

4. **Don't set `z-index` on v2 components arbitrarily.**
   The overlay system uses `z-index: 50` for dialogs and scrims. Additional
   layers should be coordinated through the elevation model, not ad-hoc z-index
   values.

5. **Don't use Inter-specific weights without fallback.**
   Inter's `font-weight: 530` may not render identically in all environments.
   Ensure the font is loaded before v2 CSS applies, or provide a fallback stack.

## Appendix: component inventory

### v2 components (30 exported, `packages/ui/src/v2/components/`)

| Component | File | Variants |
|---|---|---|
| AccordionV2 | `accordion-v2.tsx` | — |
| Avatar | `avatar-v2.tsx` | size: small/normal/large, kind: user/org |
| BadgeV2 | `badge-v2.tsx` | Exported as `Tag` |
| BasicToolV2 | `basic-tool-v2.tsx` | — |
| ButtonV2 | `button-v2.tsx` | variant: neutral/contrast/ghost/ghost-muted, size: small/normal/large |
| CheckboxV2 | `checkbox-v2.tsx` | — |
| DialogV2 | `dialog-v2.tsx` | size: normal/large/x-large, variant: default/settings, fit |
| DiffChangesV2 | `diff-changes-v2.tsx` | — |
| FieldV2 | `field-v2.tsx` | — |
| Icon | `icon.tsx` | 106 named icons |
| IconButtonV2 | `icon-button-v2.tsx` | — |
| InlineInputV2 | `inline-input-v2.tsx` | — |
| KeybindV2 | `keybind-v2.tsx` | — |
| LineCommentV2 | `line-comment-v2.tsx` | — |
| MenuV2 | `menu-v2.tsx` | — |
| ProjectAvatarV2 | `project-avatar-v2.tsx` | — |
| RadioV2 | `radio-v2.tsx` | — |
| SegmentedControlV2 | `segmented-control-v2.tsx` | — |
| SelectV2 | `select-v2.tsx` | — |
| SwitchV2 | `switch-v2.tsx` | hideLabel |
| TabStateIndicator | `tab-state-indicator.tsx` | — |
| TabsV2 | `tabs-v2.tsx` | variant: normal/pill/settings, orientation: horizontal/vertical |
| TextInputV2 | `text-input-v2.tsx` | appearance: base/large, numeric, invalid, showCopyButton |
| TextShimmerV2 | `text-shimmer-v2.tsx` | — |
| TextareaV2 | `textarea-v2.tsx` | — |
| ToastV2 | `toast-v2.tsx` | — |
| ToolErrorCardV2 | `tool-error-card-v2.tsx` | — |
| TooltipV2 | `tooltip-v2.tsx` | — |
| WordmarkV2 | `wordmark-v2.tsx` | — |
