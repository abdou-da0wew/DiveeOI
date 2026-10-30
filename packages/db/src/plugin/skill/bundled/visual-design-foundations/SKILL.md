---
name: visual-design-foundations
description: Apply typography, color theory, spacing, and iconography principles to establish coherent, accessible visual systems.
category: Design
tags: [visual-design, typography, color, spacing, accessibility]
triggers: [design tokens, visual hierarchy, typography scale, color palette, design system]
compatibility: Text-only design guidance with bundled Markdown references; no external tool or package is required.
---

# Visual Design Foundations

Use these principles to create or review a consistent visual system. Adapt recommendations to the existing product, brand, platform, and accessibility needs rather than applying a generic template.

## Core systems

1. **Typography:** choose a readable typeface and a restrained, consistent scale. Check line length, line height, hierarchy, language coverage, and responsive behavior. See `references/typography-systems.md`.
2. **Color:** define semantic tokens for surfaces, text, borders, actions, and status. Check contrast in every theme and state; do not rely on color alone. See `references/color-systems.md`.
3. **Spacing:** use a consistent spacing scale while preserving optical alignment and sufficient touch targets. See `references/spacing-iconography.md`.
4. **Iconography:** use one coherent family, consistent stroke/weight, and accessible labels for non-decorative icons.
5. **Hierarchy:** establish a clear focal point, readable scanning order, and intentional density.

## When applying

- Inspect existing tokens and components before adding new ones.
- Use the smallest set of tokens that covers real use cases.
- Test focus, hover, disabled, error, empty, loading, and responsive states.
- Follow the user's existing design direction unless they ask for a redesign.
