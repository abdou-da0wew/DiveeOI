---
name: task-review
description: Review a completed task or extract a reusable lesson when the user asks for a retrospective, a durable memory, or a reusable skill.
category: Quality
tags: [review, retrospective, memory, lessons-learned]
triggers: [review this task, retrospective, save this lesson, remember this process]
compatibility: Uses DiveeOI's existing memory and skills facilities; does not create or modify durable files without authorization.
---

# Task Review

Use this skill when the user asks to review completed work, capture a lesson, or make a process reusable. It is not a requirement to run a retrospective after every task.

## Review process

1. Compare the original request and acceptance criteria with the delivered result.
2. Separate verified outcomes from assumptions, limitations, and unresolved work.
3. Identify any repeatable workflow, stable constraint, or pitfall that is likely to matter again.
4. Check existing project memories and skills for overlap before proposing an update.
5. Recommend the smallest durable destination: update an existing memory, update a project skill, or create a new skill only when it captures a distinct repeatable procedure.
6. Ask before writing or changing durable memory/skill files unless the user has already authorized that specific update.

## Good retrospectives

- Preserve the actual sequence of actions and the evidence that validated the outcome.
- Record only observed pitfalls; do not invent lessons.
- Avoid secrets, one-off state, and speculative details.
- Keep the result concise, project-scoped, and easy to retrieve later.
- Use a professional tone; do not add decorative emojis to important or technical updates.
