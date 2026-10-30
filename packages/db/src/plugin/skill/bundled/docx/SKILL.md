---
name: docx
description: Create, inspect, or revise Word documents while preserving the user's facts, intended structure, and formatting requirements.
category: Documents
tags: [docx, documents, word-processing, editing]
triggers: [create a Word document, edit DOCX, document formatting, review a DOCX]
argument-hint: Describe the document type, audience, source material, and requested changes
version: "1.0.0"
author: DiveeOI
compatibility: Original DiveeOI guidance. DOCX parsing or rendering depends on tools already installed in the current environment; do not assume a library or Office application is available.
---

# DOCX Documents

Use this skill for `.docx` creation, review, or revision. Inspect the available project tools before choosing a method; do not install packages or run setup scripts without approval.

## Workflow

1. Confirm the intended audience, purpose, language, output path, and whether the task is to create a new file or edit an existing one.
2. Read available source material and preserve names, dates, numbers, quotations, and claims. Ask about ambiguities rather than filling factual gaps.
3. Plan a clear document structure with useful headings, lists, tables, and captions. Apply the user's template or the project's conventions when provided.
4. Use a DOCX-capable tool that is already installed. If none is available, offer a Markdown or plain-text draft instead of claiming to create a Word file.
5. Review the document for heading hierarchy, consistent styles, readable tables, page breaks, link text, and visible placeholders. If rendering is unavailable, state that visual pagination was not checked.
6. Preserve tracked changes and comments when requested; never silently flatten or discard them.
7. Save only to the requested or agreed location and report the file and any verification limits.

Do not run arbitrary macros, overwrite an input file without permission, or add unverified personal or legal claims.
