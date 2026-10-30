---
name: resume-builder
description: Create or improve a truthful, readable resume from a candidate's real experience, with optional ATS-oriented checks and export guidance.
category: Career
tags: [resume, career, job-search, editing]
triggers: [write my resume, improve my resume, resume review, ATS, resume template]
argument-hint: Share the target role and relevant experience or an existing resume
compatibility: Works with text and bundled templates. Optional ATS script requires Python 3; DOCX/PDF exports require the relevant tools and dependencies to be available.
---

# Resume Builder

Use this skill when the user asks to create a resume from scratch, improve an existing resume, or review resume structure. For tailoring to a specific job description, first confirm that the user wants a targeted version.

## Workflow

1. **Collect truthful source material.** Ask for role targets, work history, education, skills, accomplishments, and any constraints. When the user has a resume file, use the available file tools to read it; do not assume PDF or DOCX parsers are installed.
2. **Choose a format.** Read `references/templates/` and select a suitable structure. Ask before choosing a specialized industry layout if the direction is unclear.
3. **Improve content.** Use action, scope, and outcomes where supported. Preserve employer names, titles, dates, qualifications, and metrics exactly unless the user confirms a correction. Mark missing facts with a question or `[TODO]`; never invent them.
4. **Check readability and ATS basics.** Prefer a clear hierarchy, ordinary section labels, consistent dates, and text that remains readable when copied. Avoid promising an ATS score or a guaranteed interview.
5. **Optional script.** The bundled `scripts/ats_check.py` may be run with Python 3 after inspecting its inputs and confirming it is appropriate. It is an advisory checker, not an authoritative hiring-system simulation.
6. **Export.** Return Markdown/plain text by default. Use DOCX/PDF tooling only when available and requested; do not install packages or run setup scripts without approval.
7. **Review.** Show assumptions and questions that still need user confirmation.

## Bundled references

Use `references/intake_questions.md`, `references/star_rewrite_guide.md`, `references/export_guide.md`, and the relevant template files as needed. The bundled examples and keyword lists are guidance, not evidence about the user's experience.
