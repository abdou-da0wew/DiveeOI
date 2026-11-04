# Targeted Learning settings polish — 2026-11-04

## Requested changes

- Replace native disclosure triangles with real section icons.
- Match preset buttons to the app's standard button treatments, including hover and pressed feedback.
- Show setup-step and health states as compact, colored status badges for success, failure, not-yet-done, running, and skipped states.
- Keep V1 and V2 visually consistent and responsive.

## Implementation

- Added `targeted-learning-status.tsx` as the shared badge and setup-step label component.
- Added `targeted-learning.css` for compact status pills, status rows, health cards, icon-led accordion headers, chevron transitions, and reduced-motion handling.
- Added distinct success (green), danger (red), warning/pending (amber), info/running (blue), and neutral/skipped badge treatments using the existing theme tokens.
- Added explicit step names for Probe, Preflight, Download, Verify, Runtime check, Golden self-test, Benchmark, and Recommend profile.
- Replaced native summaries' default triangle markers with SVG icon + chevron headers. The chevron rotates while the native `details` element preserves keyboard and disclosure behavior.
- Preset controls now use the shared V1 `Button` component or V2 `ButtonV2` component; the selected layout automatically gets its standard button hover/focus/pressed styles. The currently applying preset displays an Applying state and disables concurrent preset actions.
- Setup health checks distinguish initial setup/in-progress (pending) from a real failure. Backend unreachable and needs-repair are shown as failures.

## Browser QA

Used a temporary backend at `127.0.0.1:4102` with fresh XDG config/data/state/cache directories and a disposable local Basic-auth identity, and Vite at `127.0.0.1:3006`. The production service and production data were not used.

A browser-only fetch fixture returned a synthetic mixed setup result to verify all badge colors without starting any real setup task, downloading a model, uploading books, or changing server settings:

- Complete steps: green.
- Failed Download step and failed books.db health: red.
- Pending Verify step: amber.
- Running Runtime check: blue.
- Skipped Golden self-test: neutral “Not run”.
- Loaded manifest and ready model health: green.

V1 and V2 were both checked. Accordion icons resolve to registered SVG symbols, the default triangle marker is hidden, and the chevron rotates on open. Preset hover states were checked against computed styles from the shared button components. Both V1 and V2 were tested at 543×580; the document remained 543px wide with no horizontal overflow. No browser errors remained.

Screenshots:

- `screenshots/targeted-learning-v2-status-fixture-20261104.png`
- `screenshots/targeted-learning-v1-status-fixture-20261104.png`
- `screenshots/targeted-learning-v1-accordions-20261104.png`
- `screenshots/targeted-learning-v1-mobile-20261104.png`
- `screenshots/targeted-learning-v2-mobile-status-20261104.png`

## Verification

- App + UI typecheck: 2/2 packages passed.
- App unit suite: 429 passed, 0 failed, 1,101 assertions.
- UI package suite: 68 passed, 0 failed, 140 assertions.
- Focused Oxlint on changed TSX files: passed.
- `git diff --check`: passed.
- Production app build: passed.

The full repository lint command is not green because the existing working-tree modification in `packages/learning/src/chunk/index.ts` contains a parse error at line 123 (`parseResul / zzt.outline`). That file is outside this UI task and was not changed as part of this work; it was deliberately left untouched. Focused lint on the changed UI TSX files passed.

## Safety / deployment

- All browser testing used temporary isolated data.
- The setup button was not clicked, no model download occurred, no books were uploaded, and no preset was applied to real settings.
- No live service restart or deployment occurred.
- No commit or push was made.
