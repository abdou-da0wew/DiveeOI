---
name: coenx-video-fonts
description: Search, select and apply font families from the fully bundled Coenx font library, including Arabic and Latin typography, without remote font dependencies.
---

# Bundled font library

Use only families in the bundled manifest resource. It lists style, recommended uses, supported scripts, weights, filenames and each family's SIL Open Font License notice. The package API exports FONT_CATALOG, findFontFamily, recommendFontFamily and FONT_FACE_CSS.

The current library includes Geist, Geist Mono, Space Grotesk, Space Mono, Manrope, DM Sans, DM Mono, Fraunces, Bricolage Grotesque, IBM Plex Sans, JetBrains Mono, Bebas Neue, Cairo, Tajawal, Amiri and Noto Sans Arabic.

Select families according to a role:

- Display/headline: Space Grotesk, Bricolage Grotesque, Fraunces or Bebas Neue.
- Body/UI: Geist, Manrope, DM Sans or IBM Plex Sans.
- Technical/data: Geist Mono, JetBrains Mono or DM Mono.
- Arabic body/UI: Cairo, Tajawal or Noto Sans Arabic.
- Arabic quotations/editorial: Amiri, with an Arabic sans body companion.

For Arabic and mixed-script projects, verify that both Arabic and Latin glyph subsets are present for the chosen family. The manifest's scripts field is authoritative. Do not use a Latin-only font for Arabic. Consider RTL flow, line breaking, shaping, diacritics, punctuation and numerals.

Use no more than two primary families in most videos. Reserve display faces for short copy. Use explicit weights and sizes; do not fake a bold face with repeated strokes or distort letterforms. Confirm font loading before capturing interactive output. Interactive exports embed the font CSS and local font bytes. MP4 exports stage the selected local font files in a temporary Fontconfig directory. Neither output depends on network access or a font installed on the host/client.

The resource bundle includes WOFF2 data and one OFL notice per font family. Do not strip or replace those notices. Font binaries are licensed separately from DiveeOI's source code.\n\n
