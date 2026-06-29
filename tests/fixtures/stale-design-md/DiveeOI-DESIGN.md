---
version: alpha
name: DiveeOI
colors:
  primary: "#dcde8d"
  neutral: "#f7f7f7"
  success: "#12c905"
  warning: "#ffdc17"
  error: "#fc533a"
  info: "#a753ae"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 180%
  heading:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: 20px
    fontWeight: 500
    lineHeight: 180%
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 13px
rounded:
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 10px
spacing:
  base: 4px
components:
  button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-invert-base}"
    rounded: "{rounded.md}"
    padding: 0 6px
    height: 28px
    variants: [primary, secondary, ghost]
    sizes: [small, normal, large]
  input:
    backgroundColor: "{colors.surface-base}"
    textColor: "{colors.text-base}"
    rounded: "{rounded.md}"
    padding: 2px 12px
    height: 32px
---

# Design System: DiveeOI

## 1. Overview

DiveeOI is a fork of OpenCode that extracts only the web UI and server components.
The TUI subsystem has been completely removed. The UI is built with SolidJS and
Kobalte accessible primitives.

The project uses a monorepo structure managed by Bun and Turborepo.

## 2. Colors

The design system uses an Oklch-based theme engine with 38 built-in themes.

### Light Mode
| Token | Value | Usage |
|---|---|---|
| Primary | `#dcde8d` | Brand accent, primary actions, selected states |
| Neutral | `#f7f7f7` | Surface backgrounds |
| Ink | `#171311` | High-emphasis text |
| Success | `#12c905` | Positive outcomes, success indicators |
| Warning | `#ffdc17` | Caution, pending states |
| Error | `#fc533a` | Errors, destructive actions |
| Info | `#a753ae` | Informational elements |
| Interactive | `#034cff` | Links, focus rings |

### Dark Mode
| Token | Value | Usage |
|---|---|---|
| Primary | `#fab283` | Brand accent (dark) |
| Neutral | `#1f1f1f` | Surface backgrounds (dark) |
| Ink | `#f1ece8` | High-emphasis text (dark) |

### Semantic Token Patterns

Colors are resolved into semantic tokens:
- `--colors-text-strong`, `--colors-text-base`, `--colors-text-weak`, `--colors-text-weaker`
- `--colors-surface-base`, `--colors-surface-raised-base`
- `--colors-border-weak-base`
- `--colors-icon-*`

### Syntax Highlighting
Code blocks use a distinct syntax color palette for tokens, keywords, strings, etc.

## 3. Typography

Uses a system sans-serif font stack for UI elements and a system monospace stack
for code. No custom fonts are loaded — performance reasons.

| Size | Used For |
|---|---|
| 13px | Labels, small UI text |
| 14px | Body text, button labels |
| 16px | Secondary headings |
| 20px | Primary headings |

Font weights: Regular (400), Medium (500), Bold (600/700).

## 4. Components

### Button
- Variants: `primary`, `secondary`, `ghost`
- Sizes: `small` (24px), `normal` (28px), `large` (32px)
- Data attributes: `data-component="button"`, `data-variant`, `data-size`
- Styling via CSS custom properties, never hardcoded colors

### Dialog
- Uses Modal primitive with portal rendering
- Overlay animation: fade-in 250ms
- Content animation: scale-fade-in 150ms
- Backdrop click to close

### All Components
- Framework: Kobalte primitives
- Pattern: component wraps primitive, spreads remaining props
- Props: `variant`, `size`, `class`, `classList`
- States: base, hover, active, focus-visible, disabled, selected

## 5. Icons

SVG `<symbol>` sprite system. 80+ named icons.
Usage: `<Icon name="chevron-down" size="small" />`

Icon sizes: small (12px), normal (16px), medium (20px), large (24px).

## 6. Adding a New Component

1. Create `<name>.tsx` and `<name>.css` in the correct package directory
2. Wrap the appropriate Kobalte primitive
3. Add `data-component`, `data-variant`, `data-size` attributes
4. Use only `var(--token-name)` for all colors and spacing
5. Add a companion `<name>.stories.tsx` file
