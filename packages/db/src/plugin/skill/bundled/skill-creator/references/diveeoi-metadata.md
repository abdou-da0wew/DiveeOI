> **DiveeOI addition:** This reference documents project-specific metadata support and is not part of the upstream skill-creator text.

# DiveeOI Skill Metadata Reference

DiveeOI reads skill metadata from YAML frontmatter in `SKILL.md`. The required discovery fields are `name` and a concise `description`; other fields enrich APIs, prompts, slash-command visibility, and provenance.

```yaml
---
name: example-skill
description: Do a specific task when the user asks for it.
category: Development
tags: [testing, typescript]
triggers: [test, typecheck, validate]
version: 1.2.0
author: Example Author
license: MIT
compatibility: Uses the current DiveeOI shell and file tools.
homepage: https://example.invalid/skill
repository: https://github.com/example/skills
sourceRepository: https://github.com/example/skills
sourceRevision: 0123456789abcdef
requirements:
  tools: [read, shell]
  binaries: [node]
  environment: []
allowed-tools: [read, grep]
argument-hint: Describe the code or test area
user-invocable: true
disable-model-invocation: false
metadata:
  vendor-field: preserve-compatible-data
---
Skill instructions go here.
```

## Field behavior

- `name` and `description` are the main discovery fields.
- `category`, `tags`, and `triggers` are preserved as discovery hints for API/UI clients; they are not permissions.
- `version`, `author`, `license`, `compatibility`, `homepage`, `repository`, `requirements`, and arbitrary root/nested extension keys are preserved for clients.
- `sourceRepository` and `sourceRevision` identify the pinned content source for a bundled skill. `source` in the API identifies the runtime origin (`embedded`, `directory`, or `url`).
- `user-invocable: false` hides a skill from user slash-command listings.
- `disable-model-invocation: true` hides it from the automatic skills list in the model context; it does not bypass permissions or make the skill inaccessible to an explicit tool call.
- `allowed-tools` is descriptive metadata, not a security boundary. DiveeOI's permission system remains authoritative.

Use compact descriptions that tell the agent both what the skill does and when to select it. Add requirements only when the skill genuinely depends on a tool, executable, environment variable, or package. Never claim that DiveeOI has an integration merely because a skill's source text mentions it.
