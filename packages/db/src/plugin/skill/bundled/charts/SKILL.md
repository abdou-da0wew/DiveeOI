---
name: charts
description: Create clear, accurate charts and diagrams that fit the data, audience, project stack, and requested output format.
category: Design
tags: [charts, diagrams, visualization, dashboards]
triggers: [chart, diagram, flowchart, visualize data, dashboard, graph]
argument-hint: Describe the data or process and preferred output format
version: "1.0.0"
author: DiveeOI
compatibility: Original DiveeOI guidance; requires no specific renderer. Use only libraries already available in the project unless the user approves installation.
---

# Charts and Diagrams

Use this skill when the user asks to create or improve a chart, diagram, graph, or dashboard. Follow the requested output format and the repository's existing stack.

## Choose the representation

1. Identify the question the visualization should answer, the audience, data types, and whether the output should be source code, an image, HTML, or a document-embedded graphic.
2. Select a chart that faithfully represents the data: comparisons, trends, distributions, relationships, or proportions each call for different encodings. Use a table or prose when it communicates more accurately.
3. Inspect the project and available renderers before choosing an implementation. Do not assume that a particular Python or JavaScript package, browser, or CLI is installed.
4. If no renderer is available, provide a portable source representation (for example, Mermaid for supported diagrams) or explain the dependency needed. Ask before installing dependencies.

## Quality checks

- Label axes, units, ranges, categories, and source data; cite external data.
- Use accessible contrast and redundant encodings such as labels or patterns; do not rely on color alone.
- Avoid misleading scales, unsupported precision, clutter, and overlapping labels.
- Keep diagrams semantically consistent and make relationships, flow direction, and grouping explicit.
- Validate the rendered output when a renderer is available; never claim visual validation that was not performed.
