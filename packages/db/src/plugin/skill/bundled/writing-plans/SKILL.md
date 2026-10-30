---
name: writing-plans
version: 0.1.0
category: Development
tags: [planning, implementation, testing, task-breakdown]
triggers: [implementation plan, multi-step task, technical plan, break down]
argument-hint: Describe the feature or requirements to plan
description: Create a concrete, testable implementation plan from a specification or multi-step request, before changing code when a plan is useful.
compatibility: DiveeOI-native planning guidance; does not require subagents or external skills.
---

# Writing Plans

Use this skill when the user requests a plan or the work has enough dependencies and risks that a written sequence will improve execution. Do not turn a small isolated edit into a ceremony.

## Plan structure

1. **Goal and acceptance criteria** — restate the requested outcome and how completion will be observed.
2. **Current state** — list the relevant modules, constraints, and existing behavior discovered in the repository.
3. **Approach** — describe the design and important alternatives or risks.
4. **Steps** — use ordered, bite-sized tasks. Each step should identify likely files, expected result, and verification.
5. **Validation** — name focused tests, type checks, builds, or manual procedures, noting any environment limitations.
6. **Open questions** — include only decisions that actually block a safe or correct plan.

## Quality rules

- Use exact paths only after checking they exist or clearly mark new files as proposed.
- Make steps independently verifiable where practical; avoid inventing commands or APIs.
- Include documentation, migration, security, compatibility, and failure cases when relevant.
- Respect the repository's own conventions over generic templates.
- Do not include commit, push, deployment, or irreversible actions unless requested.
- If the user asked for implementation as well as planning, continue to implementation after the plan unless they asked to stop at the plan.

Save the plan to a repository file only when the user asks or the repository's task convention requires it; otherwise return it in the conversation.
