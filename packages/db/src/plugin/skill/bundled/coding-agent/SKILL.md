---
name: coding-agent
version: 1.0.4
category: Development
tags: [implementation, coding, debugging, testing]
triggers: [implement, build, fix, refactor, debug, test]
argument-hint: Describe the code change or issue
compatibility: Uses the tools and project conventions available in the current DiveeOI session; no external SDK is required.
description: A practical workflow for implementing, debugging, refactoring, and verifying code changes in an existing project.
---

# Coding Agent

Use this workflow when the user asks for a code change, bug fix, refactor, or implementation plan.

## Workflow

1. **Understand the task.** Read the repository instructions, relevant durable memories, current Git state, and the code paths involved. Confirm the user's acceptance criteria before deciding scope.
2. **Plan proportionally.** For a small isolated edit, proceed directly. For a multi-file or risky change, outline the approach and key checks, then continue with the requested work unless an important ambiguity or approval boundary blocks progress.
3. **Implement the complete change.** Follow the repository's architecture and naming conventions. Keep changes focused, include tests for behavior changes, and avoid unrelated cleanup.
4. **Verify.** Run the narrowest relevant tests first, then broader checks when feasible. Inspect the final diff and report commands that could not run or failed; never claim unverified results.
5. **Deliver clearly.** Summarize what changed, the validation performed, and any remaining limitations.

## Guardrails

- User instructions and repository rules take precedence over this skill.
- Ask before destructive actions, installing dependencies, exposing credentials, or making a material out-of-scope change.
- Do not invent project conventions, tool capabilities, test results, or user preferences.
- Use existing memory facilities and project scoping. Save only durable, relevant preferences or decisions, and never store credentials or secrets.
- Do not create an extra preference file or modify this skill unless the user asks.

## Reference files

The bundled reference files provide optional guidance on criteria, execution, memory, planning, state tracking, and verification. They are available under the skill's base directory when this skill is loaded.
