---
name: pptx
description: Create, inspect, or revise PowerPoint presentations with a clear narrative, readable slides, and accurate speaker notes.
category: Documents
tags: [presentations, pptx, slides, communication]
triggers: [create slides, PowerPoint, presentation, revise a deck, speaker notes]
argument-hint: Describe the audience, purpose, approximate slide count, and source material
version: "1.0.0"
author: DiveeOI
compatibility: Original DiveeOI guidance. Use project-installed presentation tooling only; no external search provider, subagent, renderer, or specific framework is assumed.
---

# PowerPoint Presentations

Use this skill when the user asks to create, inspect, or edit a `.pptx` deck. Follow the audience, purpose, length, language, and visual direction the user specifies.

## Workflow

1. Clarify the deliverable, audience, purpose, approximate slide count, language, and whether the request is for a new deck or a revision. Ask only for details that materially affect the result.
2. Inspect available source material and presentation tools. Preserve original facts, data, source links, and visual intent. Do not install dependencies or run setup scripts without approval.
3. Plan the narrative before writing slides. Use one main idea per slide, with a logical progression from context to evidence to conclusion or action.
4. Keep text concise and readable; use charts only when they improve understanding. Label data, cite claims, and provide alt text or equivalent descriptions where supported.
5. Review slide order, hierarchy, contrast, font size, overflow, notes, citations, and consistency. If no renderer is available, state that visual layout could not be verified.
6. Save the deck at the requested location, preserve the input deck unless asked to replace it, and report any limitations or unverified features.

Do not invent evidence, metrics, quotations, or speaker notes. If a requested animation, transition, embedded object, or layout cannot be supported by the available tools, explain that before substituting another approach.
