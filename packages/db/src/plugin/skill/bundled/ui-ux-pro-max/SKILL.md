---
name: ui-ux-pro-max
description: Provide evidence-informed UI/UX design direction, design-system guidance, accessibility checks, and concrete frontend implementation recommendations.
category: Design
tags: [ui, ux, frontend, design-system, accessibility]
triggers: [design a UI, improve UX, design tokens, frontend polish, accessibility review]
argument-hint: Describe the screen, product, target platform, and constraints
compatibility: Bundled CSV data and Python scripts are local resources. The search script uses Python 3 standard-library modules; verify project tooling before running it.
---

# UI/UX Pro Max

Use this skill to design or review interfaces and translate recommendations into project-compatible code. Inspect the existing project and reuse its framework, components, tokens, and conventions; do not assume React, Next.js, Tailwind, or any particular design system.

## 1. Triage

Identify the user goal, target platform, audience, existing stack, brand constraints, and important states. Ask only questions needed to avoid a materially wrong design.

## 2. Choose the appropriate deliverable

- **UI concept:** layout, hierarchy, typography, colors, spacing, and interactions.
- **UX flow:** critical paths, validation, loading/empty/error/success states, and recovery.
- **Design system:** tokens, component rules, responsive behavior, and accessibility notes.
- **Implementation:** focused file-level changes that follow the existing codebase.

## 3. Use bundled design data when helpful

The skill tool reports a base directory. Use it as `SKILL_DIR`; the bundled CSV catalog is in `data/` and the scripts are in `scripts/`.

Optional Python search:

```bash
python3 "$SKILL_DIR/scripts/search.py" "accessible dashboard" --domain ux
python3 "$SKILL_DIR/scripts/design_system.py" --help
```

These scripts read the bundled CSVs and do not require a vendor API. If Python is unavailable, consult the CSV files directly or proceed using repository conventions and clearly state the limitation. Do not persist design-system files unless the user requests implementation or saved artifacts.

## Output standards

- Make concrete recommendations and explain trade-offs briefly.
- Include responsive behavior, keyboard/focus states, contrast, and empty/loading/error states.
- Use the project's existing naming and component patterns; avoid forcing a preferred framework.
- Treat the bundled catalog as guidance, not a substitute for user requirements, existing product design, or accessibility verification.
