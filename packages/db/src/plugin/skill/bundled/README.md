# Bundled skill curation and provenance

The source snapshot reviewed for this bundle is [`abdou-da0wew/zcode-skills`](https://github.com/abdou-da0wew/zcode-skills), commit `67bcca5e0467bda037dfe18d691d91f3386191f9`. The registry at `../../skill.ts` deliberately includes a curated set rather than importing the repository wholesale. Each embedded entry records its source repository/revision when it contains adapted upstream material; companion files are listed explicitly in `index.ts`.

## Adapted skills with source resources

- `coding-agent`, `writing-plans`, `task-review`
- `deep-research`, `research-explorer`
- `visual-design-foundations`, `ui-ux-pro-max`
- `content-strategy`, `blog-writer`, `seo-content-writer`
- `skill-creator`, `interview-prep`, `interview-designer`, `resume-builder`

The portable versions use DiveeOI conventions, remove unsupported tool assumptions, avoid automatic installation/publication, and preserve only the text companion resources referenced by their instructions. `blog-writer` is generic; upstream personal writing samples and the example-management script are not bundled. `pptx` is an original DiveeOI guide with no upstream scripts or helper assets.

`skill-creator` and `seo-content-writer` declare Apache-2.0. Their `LICENSE.txt` files are retained; modified skill files have adaptation notices, and `skill-creator/NOTICE.txt` records provenance and changes.

## Restrictive per-skill licenses

The upstream `charts`, `docx`, `pdf`, and `xlsx` directories include licenses granting personal, educational, and non-commercial use only and prohibiting commercial use without prior written permission. Those source instructions, references, scripts, and license files are **not** redistributed here. The same skill names have small, independently authored DiveeOI guides that do not include those upstream resources. Obtain explicit permission before including the upstream packages in a commercial product.

The upstream repository has no root-level license. Public visibility alone is not a redistribution license. This curation makes no claim that unlicensed upstream material is open-source; broader redistribution of those adaptations should be covered by authorization from the relevant rights holders. The pinned provenance is retained so those decisions remain auditable.
