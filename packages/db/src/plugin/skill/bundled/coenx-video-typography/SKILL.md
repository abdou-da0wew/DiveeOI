---
name: coenx-video-typography
description: Choose, pair and tune bundled font families for motion graphics, subtitles, diagrams and Arabic or Latin educational content in Coenx video projects.
---

# Typography for video

Use the bundled font catalogue. Never assume Inter, a remote Google Fonts URL, or a font installed on the viewer's device. The catalogue is available to the agent through the font-library manifest resource and the package API under @diveeoi/coenx-video/fonts.

Choose by role and script coverage, not by fashion alone. Pair one expressive headline face with one highly readable body face and, when useful, one monospace accent. Avoid using more than two families in a normal scene unless the style specifically needs it.

Recommended pairings:
- Modern technology: Space Grotesk headings, Geist or Manrope body, Geist Mono data.
- Neutral product explainer: Geist headings and body, Geist Mono labels.
- Editorial: Fraunces headings and DM Sans body.
- Scientific or technical: IBM Plex Sans body and JetBrains Mono or Geist Mono for values.
- Arabic UI and captions: Cairo or Tajawal for headings and body, Noto Sans Arabic for dense text.
- Arabic editorial: Amiri for selected quotations or headlines, paired with Cairo or Noto Sans Arabic body.
- Poster title: Bebas Neue or Bricolage Grotesque for short display copy only.

Arabic text must use a family whose manifest includes Arabic glyph coverage. Do not apply Latin-only families to Arabic or assume the system fallback will produce a matching design. Use a compatible Arabic face for mixed-language text and verify shaping, ligatures, punctuation, numerals and RTL layout in the actual target renderer.

Set explicit font-family, font-size, font-weight, text-align and line-height values. Maintain contrast and generous line spacing. Never stretch text with transforms to force it into a box; rewrite, wrap or recompose the layout.

The full manifest, individual font binaries and per-family SIL Open Font License notices are bundled as skill resources. Preserve the specific family license notice when redistributing its font files.\n