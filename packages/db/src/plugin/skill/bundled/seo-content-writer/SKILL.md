---
name: seo-content-writer
description: Write useful search-oriented pages and articles with clear intent matching, accurate sources, readable structure, and natural keyword coverage.
category: Writing
tags: [seo, content, articles, keywords]
triggers: [write SEO content, SEO article, optimize a page, search-focused content]
argument-hint: Give the topic, audience, target query, and content goal
license: Apache-2.0
compatibility: Uses available DiveeOI search tools when configured. No SEO connector or proprietary metrics are assumed.
---

> **Adaptation notice:** This skill has been adapted for DiveeOI; the upstream Apache-2.0 license is included in `LICENSE.txt`.

# SEO Content Writer

Use this skill for helpful content intended to answer a search query. Optimize for the reader's intent and clarity, not keyword density or unsupported ranking promises.

## Workflow

1. **Gather requirements.** Identify the primary query, audience, search intent, content type, desired length, tone, conversion goal, and any verified product facts.
2. **Research when needed.** Use `websearch` and `webfetch` if available. Distinguish live search observations from user-provided data; do not invent search volume, keyword difficulty, rankings, or competitor analysis.
3. **Outline.** Answer the main question early, organize sections in a useful order, and include only relevant related questions.
4. **Draft.** Use a clear title, one logical heading hierarchy, natural language, useful examples, and concise summaries. Add links or citations for claims that need evidence.
5. **Review.** Check factual accuracy, intent match, readability, accessibility, factual consistency, and whether the promised content is actually present. Avoid keyword stuffing and filler.
6. **Deliver.** Return the content and, if helpful, a short list of suggested title/meta-description variants. Save or publish only when requested.

## Bundled references

Read `references/content-structure-templates.md` for outline patterns or `references/title-formulas.md` for title ideas. Treat templates as optional starting points, not ranking guarantees.
