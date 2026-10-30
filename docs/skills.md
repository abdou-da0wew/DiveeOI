# DiveeOI Skills

DiveeOI supports Markdown skills from project/global directories, skill URLs, and built-in embedded bundles. The built-in registry is declared in `packages/db/src/plugin/skill.ts`; companion text resources are statically imported by `packages/db/src/plugin/skill/bundled/index.ts` and are materialized on demand under the application cache. Keep an embedded skill's relative resource paths identical to its `SKILL.md` references.

## Frontmatter and metadata

A skill must declare a non-empty `name` and should include a concise `description` that explains both its purpose and the requests that should trigger it. Additional YAML frontmatter is parsed into `SkillV2.Info.metadata`:

| Field                                        | Meaning                                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| `category`, `tags`, `triggers`               | Discovery, grouping, and selection hints                      |
| `version`, `author`, `license`               | Skill release and attribution information                     |
| `compatibility`, `requirements` / `requires` | Supported environment and optional dependencies               |
| `homepage`, `repository`                     | Skill or project links                                        |
| `sourceRepository`, `sourceRevision`         | Pinned provenance for a bundled/adapted skill                 |
| `allowed-tools`                              | Descriptive compatibility hint only; never a permission grant |
| `argument-hint`                              | A concise input hint for a user-invocable skill               |
| `user-invocable: false`                      | Hide the skill from user-facing slash-command registration    |
| `disable-model-invocation: true`             | Exclude the skill from automatic model skill lists            |
| `metadata`                                   | Preserve vendor/extension keys in `metadata.attributes`       |

The parser accepts the main fields at the YAML root or inside `metadata`, including common kebab-case and camel-case aliases. It also maps common `metadata.clawdbot.requires`, `metadata.openclaw.requires`, and `metadata.opencode.requires` blocks to `requirements`. Unknown root and nested metadata keys are retained in `attributes` rather than discarded. Consumers should treat `attributes` and requirement values as untrusted, descriptive data.

The permission system remains the security boundary. `allowed-tools` does not enable tools, and metadata never grants filesystem, shell, network, or other permissions.

## Adding or updating an embedded skill

1. Review the selected skill's license and any resource-specific terms before copying files. Do not bundle proprietary/non-commercial assets into a product without the necessary permission. The current curated bundle intentionally omits the upstream `charts`, `docx`, `pdf`, and `xlsx` licensed packages and uses small DiveeOI-authored guides for those names.
2. Prefer adapting a portable skill. Replace unsupported tool names with actual DiveeOI capabilities, remove hard-coded paths and vendor-only features, and do not install dependencies automatically.
3. Keep only the companion files the skill actually references. Every bundled resource must be UTF-8 text; binary resources are not supported by the current embedded resource map.
4. Add a bundle entry that includes `SKILL.md` and all required files. Use forward-slash relative paths. The loader rejects absolute paths, traversal segments, encoded traversal, backslashes, and invalid cache path segments.
5. Set `sourceRepository` and an immutable `sourceRevision` for adapted external skills. Preserve license notices and add prominent change notices when the source license requires them. Do not add an unlicensed or restricted asset merely because it is publicly readable.
6. Add tests for frontmatter parsing, resource paths, model/slash invocation filters, and bundled registration.
7. Regenerate the SDK after API schema changes with `bun ./script/build.ts` from `packages/sdk`.

## Validation

Run the narrow database/server/API tests and SDK generation/typecheck when Bun dependencies are installed. Check that each reference named by a bundled `SKILL.md` exists in its resource map, and verify at least one skill end-to-end through list, prompt availability, slash-command registration, tool loading, and materialized companion files. A manual test should also confirm that a local same-name skill overrides the built-in skill and that disabling model invocation does not disable explicit user invocation.
