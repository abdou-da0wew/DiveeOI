---
version: alpha
name: "@diveeoi/test-ui-lib"
description: A small React component library with Button, Dialog, and Badge components. CSS Modules for scoping. Full light/dark theme via CSS custom properties.
---

# Design System: DiveeOI Test UI Library

## 1. Overview

A utilitarian utility-component library targeting React 19 + TypeScript. Design philosophy favors clarity over decoration: muted surfaces, a single indigo accent for primary actions, semantic color tokens for feedback (success/warning/error/info), and tight vertical rhythm. Components are small and composable — no layout primitives, no form controls, only atomic interaction widgets.

- **Package:** `@diveeoi/test-ui-lib` v0.2.0
- **Framework:** React 19 + TypeScript 5.8
- **Styling:** CSS Modules via `*.module.css`, tokens consumed as `var(--token-name)` custom properties
- **Primitives:** @radix-ui/react-dialog for Dialog, @radix-ui/react-tooltip for future extensions
- **Theme:** Light mode via `:root`, dark mode via `[data-theme="dark"]` attribute

## 2. Colors

All colors are defined as CSS custom properties on `:root` and overridden under `[data-theme="dark"]`.

### Primary (Indigo)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-primary` | `#6366f1` | `#818cf8` | Primary action background |
| `--color-primary-hover` | `#4f46e5` | `#6366f1` | Primary hover state |
| `--color-primary-soft` | `#e0e7ff` | `#1e1b4b` | Soft tinted container background |
| `--color-primary-text` | `#ffffff` | `#ffffff` | Text on primary background |

### Neutral Surfaces

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-neutral` | `#f8fafc` | `#0f172a` | Page background |
| `--color-surface` | `#ffffff` | `#1e293b` | Card/dialog surface |
| `--color-surface-hover` | `#f1f5f9` | `#334155` | Hover state on surface |
| `--color-surface-raised` | `#ffffff` | `#1e293b` | Elevated surface (modal, popover) |

### Text

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-text-strong` | `#0f172a` | `#f8fafc` | Primary text (headings) |
| `--color-text-base` | `#334155` | `#cbd5e1` | Body text |
| `--color-text-weak` | `#94a3b8` | `#64748b` | Secondary/muted text |
| `--color-text-weaker` | `#cbd5e1` | `#475569` | Placeholder text |

### Borders

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-border` | `#e2e8f0` | `#334155` | Default border |
| `--color-border-strong` | `#cbd5e1` | `#475569` | Emphasis border |

### Semantic

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-error` | `#ef4444` | `#f87171` | Error text / danger action |
| `--color-error-soft` | `#fef2f2` | `#450a0a` | Error background tint |
| `--color-success` | `#22c55e` | `#4ade80` | Success text / badge |
| `--color-success-soft` | `#f0fdf4` | `#052e16` | Success background tint |
| `--color-warning` | `#f59e0b` | `#fbbf24` | Warning text / badge |
| `--color-warning-soft` | `#fffbeb` | `#451a03` | Warning background tint |
| `--color-info` | `#3b82f6` | `#60a5fa` | Info text / badge |
| `--color-info-soft` | `#eff6ff` | `#172554` | Info background tint |

## 3. Typography

### Font Families

| Token | Value |
|---|---|
| `--font-sans` | `"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif` |
| `--font-mono` | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` |

### Font Sizes

| Token | Value | Usage |
|---|---|---|
| `--font-size-xs` | `0.75rem` (12px) | Badges, small button text |
| `--font-size-sm` | `0.875rem` (14px) | Button body, dialog description |
| `--font-size-base` | `1rem` (16px) | Large button text, general body |
| `--font-size-lg` | `1.125rem` (18px) | Dialog title |
| `--font-size-xl` | `1.25rem` (20px) | (available) |
| `--font-size-2xl` | `1.5rem` (24px) | (available) |

### Weights

| Token | Value | Usage |
|---|---|---|
| `--font-weight-regular` | 400 | Body text |
| `--font-weight-medium` | 500 | Button, badge labels |
| `--font-weight-semibold` | 600 | Dialog title |
| `--font-weight-bold` | 700 | Headings |

### Line Height

| Token | Value |
|---|---|
| `--leading-tight` | 1.25 |
| `--leading-normal` | 1.5 |
| `--leading-relaxed` | 1.75 |

### Letter Spacing

| Token | Value |
|---|---|
| `--tracking-normal` | 0 |
| `--tracking-wide` | 0.025em |
| `--tracking-wider` | 0.05em |

### Typographic Roles

- **Dialog Title:** `--font-size-lg` / `--font-weight-semibold` / `--leading-tight` / `--color-text-strong`
- **Dialog Description:** `--font-size-sm` / `--color-text-weak` / `--leading-normal`
- **Button & Badge Label:** `--font-weight-medium` / `--font-sans`

## 4. Layout & Spacing

### Spacing Scale

Power-of-2-based scale in px, consumed as `var(--spacing-N)`:

| Token | Value |
|---|---|
| `--spacing-0` | 0 |
| `--spacing-0_5` | 2px |
| `--spacing-1` | 4px |
| `--spacing-2` | 8px |
| `--spacing-3` | 12px |
| `--spacing-4` | 16px |
| `--spacing-5` | 20px |
| `--spacing-6` | 24px |
| `--spacing-8` | 32px |
| `--spacing-10` | 40px |

### Layout Patterns

- **Inline gap:** Components use `gap: var(--spacing-2)` for icon+label spacing in buttons, `var(--spacing-1)` for small variant
- **Dialog padding:** `var(--spacing-6)` (24px) content padding, `var(--spacing-4)` (16px) top padding on footer
- **Button padding:** Horizontal padding scales with size — 8px (small), 12px (normal), 16px (large)
- **Dialog min-width:** 400px, max-width: 560px, max-height: 85vh
- **Button heights:** 28px (small), 36px (normal), 44px (large)
- **Whitespace strategy:** Tight and utilitarian — minimal chrome, low internal padding relative to content size

## 5. Elevation & Depth

### Shadow Scale

Four levels defined as `box-shadow` tokens:

| Token | Value | Intensity |
|---|---|---|
| `--shadow-xs` | `0 1px 2px 0 rgba(0,0,0,0.05)` | Barely perceptible |
| `--shadow-sm` | `0 1px 3px 0 rgba(0,0,0,0.10), 0 1px 2px -1px rgba(0,0,0,0.10)` | Subtle |
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.10), 0 2px 4px -2px rgba(0,0,0,0.10)` | Moderate |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.10), 0 4px 6px -4px rgba(0,0,0,0.10)` | Pronounced |
| `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.10), 0 8px 10px -6px rgba(0,0,0,0.10)` | Highest (dialog) |

### Elevation Usage

- **Dialog overlay:** Semi-transparent black (`rgba(0,0,0,0.5)`) fills the viewport, z-index 50
- **Dialog content:** Raised via `--shadow-xl` and z-index 51, centered via absolute positioning
- **Buttons:** No shadow in resting state — flat design. Focus-visible uses a 2px primary-color outline with 2px offset.

### Animation Timing

| Token | Duration | Role |
|---|---|---|
| `--ease-fast` | 150ms | Button hover transitions (background-color, box-shadow) |
| `--ease-normal` | 200ms | Dialog overlay fade, content entrance animation |
| `--ease-slow` | 300ms | Reserved for slower transitions |

Dialog overlay fades in (`opacity 0 → 1`). Dialog content scales in (`scale(0.96) → scale(1)` with slight vertical offset) — both timed at `--ease-normal` with `ease` easing.

## 6. Shapes

### Border Radius Scale

| Token | Value | Description |
|---|---|---|
| `--radius-none` | 0 | Sharp, squared-off edges |
| `--radius-xs` | 2px | Micro rounding |
| `--radius-sm` | 4px | Slight rounding (close button) |
| `--radius-md` | 6px | Standard button rounding |
| `--radius-lg` | 8px | Dialog container rounding |
| `--radius-xl` | 12px | Generous rounding |
| `--radius-full` | 9999px | Pill-shaped (badge) |

### Shape by Component

- **Button:** `--radius-md` (6px) — subtly rounded rectangle
- **Dialog:** `--radius-lg` (8px) — rounded container
- **Badge:** `--radius-full` — pill-shaped, fully rounded

## 7. Components

### Button

| Prop | Values |
|---|---|
| `variant` | `primary`, `secondary`, `ghost`, `danger` (default: `primary`) |
| `size` | `small` (28px h), `normal` (36px h), `large` (44px h) (default: `normal`) |

#### Variant Behavior

| Variant | Rest | Hover | Disabled |
|---|---|---|---|
| **primary** | `--color-primary` bg, white text | `--color-primary-hover` | `opacity: 0.5`, `cursor: not-allowed` |
| **secondary** | White bg, `--color-text-base`, `--color-border` stroke | `--color-surface-hover` bg, `--color-border-strong` stroke | Same disabled pattern |
| **ghost** | Transparent bg, `--color-text-base` | `--color-surface-hover` bg | Same disabled pattern |
| **danger** | `--color-error` bg, white text | `#dc2626` (hardcoded dark red) | Same disabled pattern |

#### Size Dimensions

| Size | Height | Padding X | Font Size | Gap |
|---|---|---|---|---|
| small | 28px | 8px | 0.75rem | 4px |
| normal | 36px | 12px | 0.875rem | 8px |
| large | 44px | 16px | 1rem | 12px |

#### States

- **Focus-visible:** 2px solid `--color-primary` outline + 2px offset
- **Disabled:** `opacity: 0.5`, `cursor: not-allowed`, `pointer-events: none`
- **Hover:** Each variant has a distinct hover background (see table above); transitions take `--ease-fast` (150ms)

### Dialog

Built on `@radix-ui/react-dialog` with `Portal`, `Overlay`, `Content`, `Title`, `Description`, and `Close` subcomponents.

| Section | Element | Style |
|---|---|---|
| Overlay | `div` | Fixed fullscreen, `rgba(0,0,0,0.5)`, fade-in animation |
| Content | `div` | Centered via `top: 50%` + `translate(-50%,-50%)`, `--color-surface` bg, `--radius-lg`, `--shadow-xl`, scale-up entrance |
| Title | heading | `--font-size-lg`, `--font-weight-semibold`, `--color-text-strong`, `--leading-tight` |
| Description | paragraph | `--font-size-sm`, `--color-text-weak`, `--leading-normal` |
| Close | button | Absolute top-right, transparent, `--color-text-weak`, shrinks to 4px padding + `--radius-sm` |
| Footer | `div` | Flex-end row, `--spacing-2` gap, separated by `1px solid --color-border` |

#### Dimensions

- Min width: 400px
- Max width: 560px
- Max height: 85vh (scrollable)

#### Animation

- Overlay: `fadeIn` (opacity 0→1 over `--ease-normal`)
- Content: `contentShow` (opacity 0→1 + `scale(0.96) → scale(1)` + vertical `-48% → -50%` over `--ease-normal`)

### Badge

| Prop | Values |
|---|---|
| `variant` | `default`, `success`, `warning`, `error`, `info` (default: `default`) |
| `size` | `small` (10px font, 1px 4px padding), `normal` (0.75rem font, 2px 8px padding) (default: `normal`) |

#### Variant Appearance

| Variant | Background | Text Color | Border |
|---|---|---|---|
| default | `--color-surface-hover` | `--color-text-base` | `--color-border` |
| success | `--color-success-soft` | `--color-success` | none (transparent) |
| warning | `--color-warning-soft` | `--color-warning` | none (transparent) |
| error | `--color-error-soft` | `--color-error` | none (transparent) |
| info | `--color-info-soft` | `--color-info` | none (transparent) |

#### Shape

- `display: inline-flex` with `align-items: center`
- `--radius-full` (pill-shaped)
- `gap: var(--spacing-1)` for icon+label pairings

## 8. Do's & Don'ts

| # | Do | Don't |
|---|---|---|
| 1 | Use semantic variant names (`primary`, `danger`, `success`) to convey intent | Use color-only descriptions ("click the blue button") — variants are semantic, not literal |
| 2 | Wrap dialog content that needs buttons in the `footer` slot to get correct flex-end alignment and top border separation | Place action buttons directly inside dialog children without the footer wrapper — they'll lack consistent spacing |
| 3 | Apply the `ghost` variant for secondary actions placed next to primary buttons to maintain visual hierarchy | Stack two `primary` buttons in a row — use one primary and one `secondary` or `ghost` |
| 4 | Use `error` badge variant for destructive/deletion states and `success` for completion states | Use `default` badge for semantic feedback — `default` is for neutral labels only |
| 5 | Toggle `data-theme="dark"` on a parent container to switch the entire subtree to dark mode | Manually override individual color tokens per component — always use the attribute-based theme switching |
| 6 | Use `size="small"` on Badge for tight spaces like table cells or inline metadata | Use the `normal` badge size inside compact layouts — it adds excess vertical space |
| 7 | Pass `disabled` prop to Button for loading or blocked states — it applies 50% opacity and removes pointer events | Handle disabled visuals manually via className — the component handles it natively |
| 8 | Provide `description` text in Dialog for screen-reader accessibility and clear user guidance | Leave `description` empty when the dialog content is complex enough to need context |
