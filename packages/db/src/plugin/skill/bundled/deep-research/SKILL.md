---
name: deep-research
description: Conduct structured web research on open-ended questions, compare evidence across sources, and produce a cited synthesis or an HTML report when requested.
category: Research
tags: [web-research, source-evaluation, synthesis, citations]
triggers: [research this, investigate, evidence review, compare sources, research report]
argument-hint: State the research question and desired depth
compatibility: Uses DiveeOI websearch and webfetch tools when configured. Python 3 is optional for saving HTML through the bundled helper.
---

# Deep Research

Use this skill for multi-step research that needs source comparison, coverage checks, and a clear synthesis. For simple facts, use the available search tool directly.

## Research workflow

1. **Scope the question.** Identify the key subquestions, timeframe, geography, definitions, and decision the research should support. Ask only for clarifications that materially change the result.
2. **Plan source coverage.** Search for authoritative primary sources, relevant official documentation or datasets, and independent analysis. Include date-sensitive and opposing evidence where relevant.
3. **Search and verify.** Use DiveeOI's `websearch` tool, then `webfetch` the most relevant sources when available. Verify titles, dates, authors, URLs, and important quotations or figures against the source itself. Do not invent citations or claim a page was fetched when it was not.
4. **Synthesize.** Organize findings around the question rather than reproducing source summaries. Distinguish established facts, interpretation, disagreement, and uncertainty. Note source limitations and gaps in coverage.
5. **Deliver.** Give the user a concise conclusion, supporting evidence with source links, and any practical implications. Create a longer Markdown or HTML file only when requested or clearly useful; do not write files by default.

## HTML report option

If the user asks for an HTML artifact, create a self-contained, responsive document with semantic headings, accessible contrast, and citations/links. The bundled helper only writes stdin to a title-derived `.html` filename in the current working directory; it does not research or validate the HTML. Use it only after checking the base directory shown by the skill tool:

```bash
python3 "$SKILL_DIR/generate_html.py" --title "Research report" <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Research report</title></head>
<body><main><h1>Research report</h1></main></body>
</html>
HTML
```

Do not expose private chain-of-thought. Share the research plan or rationale briefly when useful, then focus on evidence and conclusions. Never imply that an unavailable web tool, provider, or database was used.
