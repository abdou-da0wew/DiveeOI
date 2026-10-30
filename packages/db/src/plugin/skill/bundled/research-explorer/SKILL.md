---
name: research-explorer
description: Turn a broad research interest into feasible candidate questions, a topic map, and a source-backed preliminary literature landscape.
category: Research
tags: [topic-discovery, literature, feasibility, web-search]
triggers: [explore research topics, narrow a research direction, research landscape, identify open problems]
argument-hint: Describe the broad field and any constraints
compatibility: Uses DiveeOI websearch/webfetch when available; no AMiner account or Python runtime is required.
---

# Research Explorer

Use this skill when the user has a broad research direction and wants to identify promising, feasible, more specific questions. Do not use it for a quick fact check or when the user already has a sharply defined question.

## Workflow

1. **Clarify the direction.** Determine the field, application area, intended audience, time horizon, available data/compute, and whether the focus is theoretical or applied. Ask only for missing constraints that affect topic selection.
2. **Map the landscape.** Use DiveeOI's `websearch` and `webfetch` tools when configured to explore recent surveys, open problems, benchmarks, applications, and adjacent fields. Prefer primary sources and authoritative surveys; check publication dates and source URLs.
3. **Generate candidate topics.** Propose five to ten questions specific enough to guide a study. For each, describe the motivation, possible contribution, evidence of prior work, feasibility, data/compute needs, and the main uncertainty. Novelty is a hypothesis, not a guarantee.
4. **Build a preliminary source table.** Include only works whose titles, dates, and URLs you could verify from sources available in this session. If fewer than 20 reliable works are found, provide fewer rather than padding the list.
5. **Recommend next steps.** Identify one to three promising directions and the evidence or feasibility checks that should come before committing to them.
6. **Deliver.** Present the topic map, candidate table, and recommendation in the conversation. Save Markdown files only when requested or when a file deliverable is clearly part of the request.

## Output quality

- Distinguish verified publication facts from search-result snippets and your interpretation.
- State uncertainty about novelty, feasibility scores, and incomplete source coverage.
- Do not claim to have used AMiner, a citation index, or any search service unless it is actually available and used.
- Do not fabricate authors, venues, dates, citation counts, or URLs.
