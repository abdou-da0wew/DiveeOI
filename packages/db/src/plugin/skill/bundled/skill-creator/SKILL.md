---
name: skill-creator
description: Create, improve, and validate DiveeOI-compatible SKILL.md files, including discovery metadata, portability, and focused evaluation prompts.
category: Development
tags: [skills, authoring, metadata, validation]
triggers: [create a skill, update a skill, improve skill metadata, validate SKILL.md]
argument-hint: Describe the skill's purpose and expected behavior
version: "1.0.0"
author: DiveeOI
license: Apache-2.0
compatibility: Original DiveeOI port of an Apache-2.0 skill. Uses repository conventions; no external endpoint, subagent, or presentation service is required.
---

> **Adaptation notice:** This skill has been adapted for DiveeOI. The upstream Apache-2.0 license is included in `LICENSE.txt`; metadata-specific guidance below was added for DiveeOI.

# DiveeOI Skill Creator

Use this skill when the user asks to author, revise, port, or validate an agent skill for DiveeOI.

## Workflow

1. **Confirm purpose and trigger.** Write one sentence describing the skill's purpose and the user request that should activate it. Avoid broad, vague descriptions.
2. **Check existing skills and project conventions.** Reuse the closest skill when appropriate. For a bundled skill, follow `docs/skills.md`; for a user skill, use the user's chosen skill directory.
3. **Write portable instructions.** State expected inputs, a practical procedure, output format, verification, and failure behavior. Refer only to tools available in the current environment, or mark alternatives as optional.
4. **Add metadata.** Use `references/diveeoi-metadata.md` for category, tags, triggers, version, author/license, compatibility, requirements, provenance, and invocation flags. Keep `allowed-tools` descriptive; DiveeOI's permission system remains authoritative.
5. **Review safety and portability.** Remove hard-coded paths, undocumented integrations, exposed credentials, automatic installs, hidden file writes, chain-of-thought requests, and assumptions that a particular model vendor is available.
6. **Validate.** Check YAML/frontmatter, required name and description, paths and referenced resources, naming uniqueness, source/license attribution, and expected triggers. Run repository tests or available validators when feasible.
7. **Evaluate with examples.** Provide realistic positive and negative prompts. Test whether the skill is selected appropriately; do not claim statistical quality from a handful of examples.
8. **Report the diff and unresolved dependencies.** Do not install packages, run untrusted helper code, publish, or change a production skill without authorization.

## Bundled reference

Read `references/diveeoi-metadata.md` for the metadata fields and current behavior. No upstream helper scripts are included; use the repository's own tests and validators where available.
