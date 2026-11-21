/** Built-in Coenx video skills and their reviewed source/reference resources. */
import { FONT_LIBRARY_RESOURCE_FILES } from "@diveeoi/coenx-video/fonts"
import skill00 from "./SKILL.md" with { type: "text" }
import skill01 from "../coenx-video-styles/SKILL.md" with { type: "text" }
import skill02 from "../coenx-video-explainer-default/SKILL.md" with { type: "text" }
import skill03 from "../coenx-video-explainer-engaging/SKILL.md" with { type: "text" }
import skill04 from "../coenx-video-explainer-high-energy/SKILL.md" with { type: "text" }
import skill05 from "../coenx-video-motion-broll/SKILL.md" with { type: "text" }
import skill06 from "../coenx-video-object-separation/SKILL.md" with { type: "text" }
import skill07 from "../coenx-video-sound-design/SKILL.md" with { type: "text" }
import skill08 from "../coenx-video-language/SKILL.md" with { type: "text" }
import skill09 from "../coenx-video-interactive/SKILL.md" with { type: "text" }
import skill10 from "../coenx-video-svg-motion/SKILL.md" with { type: "text" }
import skill11 from "../coenx-video-motion-design/SKILL.md" with { type: "text" }
import skill12 from "../coenx-video-typography/SKILL.md" with { type: "text" }
import skill13 from "../coenx-video-accessibility/SKILL.md" with { type: "text" }
import skill14 from "../coenx-video-learning/SKILL.md" with { type: "text" }
import skill15 from "../coenx-video-physics/SKILL.md" with { type: "text" }
import skill16 from "../coenx-video-storyboard/SKILL.md" with { type: "text" }
import skill17 from "../coenx-video-fonts/SKILL.md" with { type: "text" }
import skill18 from "../coenx-video-validation/SKILL.md" with { type: "text" }
import skill19 from "../coenx-video-rendering/SKILL.md" with { type: "text" }
import languageReference from "./reference/authoring-language.md" with { type: "text" }
import stylePrompts from "./references/style-prompt-library.md" with { type: "text" }
import styleCapabilities from "./references/style-capability-map.coenxjson" with { type: "text" }
import exampleMarkup from "./examples/knowledge-check.cml" with { type: "text" }
import exampleStyles from "./examples/knowledge-check.css" with { type: "text" }
import exampleScript from "./examples/knowledge-check.coenxjs" with { type: "text" }

const fontResources = Object.fromEntries(
  Object.entries(FONT_LIBRARY_RESOURCE_FILES).map(([name, content]) => ["font-library/" + name, content]),
)

export const COENX_VIDEO_SKILLS = [
  {
    name: "coenx-video",
    files: {
      "SKILL.md": skill00,
      "references/authoring-language.md": languageReference,
      "examples/knowledge-check.cml": exampleMarkup,
      "examples/knowledge-check.css": exampleStyles,
      "examples/knowledge-check.js": exampleScript,
    },
  },
  {
    name: "coenx-video-styles",
    files: {
      "SKILL.md": skill01,
      "references/style-prompt-library.md": stylePrompts,
      "references/style-capability-map.json": styleCapabilities,
    },
  },
  { name: "coenx-video-explainer-default", files: { "SKILL.md": skill02 } },
  { name: "coenx-video-explainer-engaging", files: { "SKILL.md": skill03 } },
  { name: "coenx-video-explainer-high-energy", files: { "SKILL.md": skill04 } },
  { name: "coenx-video-motion-broll", files: { "SKILL.md": skill05 } },
  { name: "coenx-video-object-separation", files: { "SKILL.md": skill06 } },
  { name: "coenx-video-sound-design", files: { "SKILL.md": skill07 } },
  {
    name: "coenx-video-language",
    files: { "SKILL.md": skill08, "references/authoring-language.md": languageReference },
  },
  { name: "coenx-video-interactive", files: { "SKILL.md": skill09 } },
  { name: "coenx-video-svg-motion", files: { "SKILL.md": skill10 } },
  { name: "coenx-video-motion-design", files: { "SKILL.md": skill11 } },
  {
    name: "coenx-video-typography",
    files: { "SKILL.md": skill12, "font-library/manifest.json": FONT_LIBRARY_RESOURCE_FILES["manifest.json"] },
  },
  { name: "coenx-video-accessibility", files: { "SKILL.md": skill13 } },
  { name: "coenx-video-learning", files: { "SKILL.md": skill14 } },
  { name: "coenx-video-physics", files: { "SKILL.md": skill15 } },
  { name: "coenx-video-storyboard", files: { "SKILL.md": skill16 } },
  { name: "coenx-video-fonts", files: { "SKILL.md": skill17, ...fontResources } },
  { name: "coenx-video-validation", files: { "SKILL.md": skill18 } },
  { name: "coenx-video-rendering", files: { "SKILL.md": skill19 } },
] as const
