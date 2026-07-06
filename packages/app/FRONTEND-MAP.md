---
version: 1.0.0
name: DiveeOI Frontend
packages:
  main: "@diveeoi/app"
  ui: "@diveeoi/ui"
type: solid-spa
framework:
  name: solid-js
  version: 1.9.0
build:
  tool: vite
  version: 7.1.0
component_count: 149
  app_specific: 57
  ui_v1: 63
  ui_v2: 29
route_count: 5
store_count: 21
last_updated: 2026-06-29
---

# DiveeOI Frontend Map

## Overview

DiveeOI is a standalone web UI fork of OpenCode — an AI coding assistant.
Two frontend packages:

- **`@diveeoi/app`** — SolidJS SPA. Routes, pages, contexts/stores, app-specific components, utilities, i18n.
- **`@diveeoi/ui`** — Shared UI component library (63 v1 + 29 v2 components), theme engine, pierre file viewer, markdown renderer, icons.

**Connection**: `@diveeoi/app` imports UI components via `@diveeoi/ui/*`, UI contexts via `@diveeoi/ui/context/*`, theme via `@diveeoi/ui/theme/*`, hooks via `@diveeoi/ui/hooks`, pierre via `@diveeoi/ui/pierre/*`.

---

## File Structure

```
packages/app/                         ← SolidJS SPA frontend
├── index.html                        # SPA entry: <div id="root">, mounts /src/entry.tsx
├── package.json                      # Framework deps, scripts, workspace ref to @diveeoi/ui
├── tsconfig.json                     # paths: { "@/*": ["./src/*"] }, jsxImportSource: solid-js
├── vite.config.ts                    # @tailwindcss/vite, vite-plugin-solid, alias @ -> src/
├── happydom.ts                       # happy-dom preload for unit tests
├── vite.js                           # Vite config helper
├── playwright.config.ts              # E2E test config
├── public/                           # Static assets (favicon)
├── e2e/                              # E2E tests + performance benchmarks
├── test-browser/                     # Browser-condition tests (virtualizer)
└── src/
    ├── entry.tsx                     # App bootstrap: Sentry init, PlatformProvider, render()
    ├── app.tsx                       # Root component: provider tree, router, route definitions
    ├── index.ts                      # Public API exports (shared with desktop)
    ├── index.css                     # Global CSS entry (imports @diveeoi/ui/styles)
    ├── components/                   # 45 app-specific components
    │   ├── prompt-input.tsx          # Main prompt composer input
    │   ├── prompt-input/             # Submit logic, toolbar
    │   ├── titlebar.tsx              # Title bar (desktop & web)
    │   ├── dialog-*.tsx              # Dialogs: settings, models, providers, MCP, server, file, etc.
    │   ├── directory-picker.tsx      # Directory/project picker dialog
    │   ├── file-tree.tsx             # File tree panel
    │   ├── settings-*.tsx            # Settings panels (general, keybinds, models, providers, servers)
    │   ├── settings-v2/              # Settings panels v2 redesign
    │   ├── server/                   # Server connection components
    │   ├── session/                  # Session-specific components (header, tabs, sortable)
    │   ├── terminal.tsx              # Terminal emulator component
    │   ├── status-popover.tsx        # Server status popover
    │   ├── help-button.tsx           # Help button
    │   └── debug-bar.tsx             # Dev debug bar
    ├── pages/                        # Route page components
    │   ├── layout.tsx                # Main visual layout (sidebar + content, ~2563 lines)
    │   ├── layout/                   # Layout sub-modules (sidebar, helpers, deep-links)
    │   ├── home.tsx                  # Landing page (project picker, session list, ~1217 lines)
    │   ├── session.tsx               # Full session page (timeline, composer, review, terminal, ~1729 lines)
    │   ├── session/                  # Session sub-modules (timeline, composer, review, terminal, side panel)
    │   ├── new-session.tsx           # Minimal draft-only page (prompt composer only)
    │   ├── directory-layout.tsx      # Per-directory provider wrapper
    │   └── error.tsx                 # Fatal error boundary page
    ├── context/                      # 20 state providers + pure utilities
    │   ├── server.tsx                # Server connection management (multi-server)
    │   ├── global.tsx                # Per-server context aggregation
    │   ├── settings.tsx              # App settings (persisted)
    │   ├── tabs.tsx                  # Session tabs (persisted)
    │   ├── layout.tsx                # Layout state (sidebar, terminal, review panels)
    │   ├── sdk.tsx                   # Directory-scoped SDK client
    │   ├── server-sdk.tsx            # Server-scoped SDK client
    │   ├── server-sync.tsx           # Global sync store (SSE-driven data)
    │   ├── sync.tsx                  # Directory-scoped sync composable
    │   ├── terminal.tsx              # Terminal PTY management
    │   ├── file.tsx                  # File content cache + tree state
    │   ├── prompt.tsx                # Prompt input state
    │   ├── comments.tsx              # Line comments on diffs
    │   ├── notification.tsx          # Session notifications (persisted)
    │   ├── permission.tsx            # Auto-accept permission rules
    │   ├── models.tsx                # AI model visibility + recent
    │   ├── language.tsx              # i18n locale + translator
    │   ├── command.tsx               # Keyboard command registry
    │   ├── highlights.tsx            # Feature highlights/changelog
    │   ├── local.tsx                 # Per-session agent/model state
    │   ├── platform.tsx              # Platform abstraction (web/desktop)
    │   └── file/                     # File subsystem (content cache, view cache, tree store)
    ├── hooks/
    │   └── use-providers.ts          # Provider list derived from sync store
    ├── i18n/                         # 18 locale dictionaries (en, zh, ja, fr, de, etc.)
    ├── utils/                        # 42 utility files (server, persist, diffs, id, etc.)
    ├── constants/
    │   └── file-picker.ts            # File picker constants
    ├── addons/                       # Serialization helpers
    ├── wsl/                          # WSL server management (desktop only)
    └── theme-preload.test.ts         # Theme preload tests

packages/ui/                          ← Shared UI component library
├── package.json                      # Component exports map, @diveeoi/ui/* paths
├── tsconfig.json                     # strict, jsxImportSource: solid-js
├── vite.config.ts                    # vite-plugin-solid, icons spritesheet plugin
├── DESIGN.md                         # Design system reference
├── script/                           # Build scripts (tailwind gen, v2 overrides)
└── src/
    ├── components/                   # 63 v1 components + 54 stories + 54 css
    │   ├── button.tsx + .css         # Button (Kobalte, data-component="button")
    │   ├── dialog.tsx + .css         # Dialog (Kobalte, data-component="dialog")
    │   ├── markdown.tsx + .css       # Markdown renderer (morphdom, Shiki, marked)
    │   ├── message-part.tsx          # Message part registry (tool/text/compaction)
    │   ├── message-nav.tsx           # Message navigation ticks
    │   ├── session-review.tsx        # Full session review with diffs + comments
    │   ├── session-turn.tsx          # Single session turn display
    │   ├── tabs.tsx                  # Tabs (Kobalte, compound)
    │   ├── select.tsx                # Select (Kobalte, generic)
    │   ├── checkbox.tsx              # Checkbox (Kobalte)
    │   ├── switch.tsx                # Switch (Kobalte)
    │   ├── text-field.tsx            # Text field (Kobalte)
    │   ├── tooltip.tsx               # Tooltip (Kobalte)
    │   ├── popover.tsx               # Popover (Kobalte)
    │   ├── hover-card.tsx            # Hover card (Kobalte)
    │   ├── context-menu.tsx          # Context menu (Kobalte, 18 sub-components)
    │   ├── dropdown-menu.tsx         # Dropdown menu (Kobalte, 18 sub-components)
    │   ├── accordion.tsx             # Accordion (Kobalte, compound)
    │   ├── collapsible.tsx           # Collapsible (Kobalte, compound)
    │   ├── card.tsx                  # Card (native, data-variant)
    │   ├── list.tsx                  # List (generic, searchable)
    │   ├── icon.tsx                  # Icon sprite system (105 icons)
    │   ├── avatar.tsx                # Avatar (native, size + fallback)
    │   ├── tag.tsx                   # Tag/badge
    │   ├── spinner.tsx               # Loading spinner
    │   ├── toast.tsx                 # Toast notifications
    │   ├── scroll-view.tsx           # Scroll view container
    │   ├── resize-handle.tsx         # Draggable resize handle
    │   ├── file.tsx + file-search.tsx# File/diff viewer (pierre integration)
    │   ├── file-icon.tsx + .css      # File type icons
    │   ├── provider-icon.tsx + .css  # AI provider icons
    │   ├── app-icon.tsx + .css       # App icons
    │   ├── logo.tsx + .css           # DiveeOI logo
    │   ├── font.tsx                  # Font loading
    │   ├── keybind.tsx               # Keybinding display
    │   ├── typewriter.tsx            # Typewriter animation
    │   ├── text-reveal.tsx           # Text reveal animation
    │   ├── text-shimmer.tsx          # Text shimmer loading
    │   ├── image-preview.tsx         # Image preview modal
    │   ├── inline-input.tsx          # Inline editable text
    │   ├── progress.tsx              # Progress bar
    │   ├── progress-circle.tsx       # Circular progress
    │   ├── radio-group.tsx           # Radio group (Kobalte)
    │   ├── tool-error-card.tsx       # Error card for tool calls
    │   ├── tool-count-label.tsx      # Tool usage count
    │   ├── tool-count-summary.tsx    # Tool usage summary
    │   ├── tool-status-title.tsx     # Tool status title
    │   ├── basic-tool.tsx            # Basic tool display
    │   ├── diff-changes.tsx          # Diff change bars
    │   ├── sticky-accordion-header.tsx # Sticky accordion header
    │   ├── dock-prompt.tsx           # Docked prompt surface
    │   ├── dock-surface.tsx          # Dock surface container
    │   ├── thinking-heading.tsx      # Thinking indicator
    │   ├── todo-panel-motion.tsx     # Todo panel with motion
    │   ├── line-comment.tsx          # Line comment display
    │   ├── apply-patch-file.tsx      # Patch application display
    │   ├── file-media.tsx            # Media file renderer
    │   ├── file-ssr.tsx              # SSR file viewer
    │   ├── session-diff.ts           # Patch parsing utility
    │   ├── session-retry.tsx         # Session retry UI
    │   ├── motion-spring.tsx         # Spring animation primitive
    │   ├── shell-submessage.css      # Shell submessage styles
    │   └── [stories files]           # Storybook stories (*.stories.tsx)
    ├── v2/                           # V2 redesign (incremental migration)
    │   ├── components/               # 29 v2 component families
    │   │   ├── button-v2.tsx + .css  # ButtonV2 (variant: neutral/contrast/ghost/ghost-muted)
    │   │   ├── dialog-v2.tsx + .css  # Dialog (size/variant/fit)
    │   │   ├── tabs-v2.tsx + .css    # TabsV2 (compound: List, Trigger, CloseButton, Content, SectionTitle)
    │   │   ├── select-v2.tsx + .css  # SelectV2 (generic)
    │   │   ├── checkbox-v2.tsx + .css# CheckboxV2
    │   │   ├── switch-v2.tsx + .css  # Switch
    │   │   ├── text-input-v2.tsx     # TextInputV2
    │   │   ├── textarea-v2.tsx       # TextareaV2
    │   │   ├── icon.tsx              # V2 icon sprite (new inline SVG system)
    │   │   ├── icon-button-v2.tsx    # IconButtonV2
    │   │   ├── avatar-v2.tsx         # Avatar
    │   │   ├── badge-v2.tsx          # Tag (size variant)
    │   │   ├── tooltip-v2.tsx        # TooltipV2
    │   │   ├── menu-v2.tsx           # MenuV2 (compound: Trigger, Content, Item, Sub, Context, etc.)
    │   │   ├── field-v2.tsx          # FieldV2 (compound: Label, Prefix, Suffix, Control)
    │   │   ├── accordion-v2.tsx      # AccordionV2 (compound)
    │   │   ├── keybind-v2.tsx        # KeybindV2
    │   │   ├── inline-input-v2.tsx   # InlineInputV2
    │   │   ├── segmented-control-v2.tsx # SegmentedControlV2 (custom, no Kobalte)
    │   │   ├── toast-v2.tsx          # ToastV2 (compound, toaster, showToast)
    │   │   ├── text-shimmer-v2.tsx   # TextShimmerV2
    │   │   ├── tool-error-card-v2.tsx# ToolErrorCardV2
    │   │   ├── diff-changes-v2.tsx   # DiffChanges
    │   │   ├── line-comment-v2.tsx   # LineCommentV2 + LineCommentEditorV2
    │   │   ├── project-avatar-v2.tsx # ProjectAvatar
    │   │   ├── wordmark-v2.tsx       # WordmarkV2
    │   │   ├── radio-v2.tsx          # RadioGroupV2 + RadioItemV2
    │   │   ├── tab-state-indicator.tsx # TabStateIndicator
    │   │   └── basic-tool-v2.tsx     # BasicToolV2
    │   └── styles/
    │       ├── colors.css            # Raw color tokens (grey 50-1200, semantic hues)
    │       ├── theme.css             # Semantic v2 CSS custom properties (light/dark)
    │       └── tailwind.css          # Imports colors + theme
    ├── context/                      # UI-level contexts
    │   ├── dialog.tsx                # DialogProvider (global dialog registry)
    │   ├── i18n.tsx                  # I18nProvider (bridges app locale to UI)
    │   ├── file.tsx                  # FileComponentProvider (inject file renderer)
    │   ├── marked.tsx                # MarkedProvider (markdown parser config)
    │   ├── data.tsx                  # DataProvider (directory data for context menus etc.)
    │   ├── helper.tsx                # Helper context
    │   ├── worker-pool.tsx           # Shiki web worker pool for syntax highlighting
    │   └── index.ts                  # Barrel export
    ├── hooks/                        # UI-level hooks
    │   ├── create-auto-scroll.tsx    # Auto-scroll on new content
    │   ├── use-filtered-list.tsx     # Filtered list with search
    │   └── index.ts                  # Barrel export
    ├── theme/                        # CSS custom property theme engine
    │   ├── context.tsx               # ThemeProvider (SolidJS context, persists to localStorage)
    │   ├── types.ts                  # DesktopTheme, ThemeVariant types
    │   ├── color.ts                  # Oklch color manipulation engine
    │   ├── resolve.ts                # Theme variant → ~200 CSS custom properties
    │   ├── v2/resolve.ts             # V2 theme variant → v2-specific tokens
    │   ├── default-themes.ts         # 38 built-in themes (oc-2, amoled, dracula, etc.)
    │   ├── loader.ts                 # Low-level applyTheme() API
    │   ├── themes/*.json             # Theme definition files (seed/palette colors)
    │   └── index.ts                  # Barrel export
    ├── styles/                       # CSS architecture (layered)
    │   ├── index.css                 # Entry: @layer theme, base, components, utilities
    │   ├── theme.css                 # CSS custom properties, typography, shadows, fallback OC-2
    │   ├── colors.css                # Raw palette tokens (~770 lines)
    │   ├── base.css                  # CSS reset
    │   ├── utilities.css             # Utility classes
    │   ├── animations.css            # Keyframe animations
    │   └── tailwind/                 # Tailwind CSS 4 integration
    │       ├── index.css             # @import tailwindcss theme + utilities + custom
    │       ├── colors.css            # Generated: all CSS vars mapped to --color-* tokens
    │       └── utilities.css         # Custom @utility directives
    ├── pierre/                       # File viewer + diff system (bridge to @pierre/diffs)
    │   ├── index.ts                  # Public API: DiffProps, createDefaultOptions, styleVariables
    │   ├── virtualizer.ts            # Ref-counted Virtualizer cache
    │   ├── file-find.ts              # In-file Ctrl+F search (CSS Highlight API + fallback)
    │   ├── file-selection.ts         # DOM→line-number mapping
    │   ├── file-runtime.ts           # <diffs-container> lifecycle management
    │   ├── diff-selection.ts         # Diff line number ↔ data-line-index mapping
    │   ├── comment-hover.ts          # Floating "+" comment button
    │   ├── commented-lines.ts        # data-comment-selected attribute marking
    │   ├── selection-bridge.ts       # Line range selection state machine
    │   ├── media.ts                  # Image/audio/SVG inline rendering
    │   └── worker.ts                 # Shiki web worker pool management
    ├── i18n/                         # 18 locale dictionaries (UI strings)
    ├── assets/                       # Static assets
    │   ├── fonts/                    # Custom fonts
    │   ├── audio/                    # Sound effects
    │   ├── icons/                    # SVG icons (provider logos, file type icons)
    │   └── images/                   # Images
    └── storybook/                    # Storybook scaffolding
        ├── fixtures.ts
        └── scaffold.tsx
```

---

## Framework & Build Config

### App (`@diveeoi/app`)

| Setting | Value |
|---|---|
| Framework | SolidJS 1.9 (jsxImportSource: `solid-js`) |
| Build tool | Vite 7.1 |
| TypeScript | strict, ESNext target, bundler module resolution |
| Path alias | `@/*` → `./src/*` |
| Env vars | `VITE_DIVEEOI_CHANNEL` (dev/beta/prod), `VITE_DIVEEOI_SERVER_USERNAME`, `VITE_DIVEEOI_SERVER_PASSWORD`, `VITE_SENTRY_*` |
| Plugins | `@tailwindcss/vite`, `vite-plugin-solid`, `vite-plugin-icons-spritesheet`, `@sentry/vite-plugin` |

### UI (`@diveeoi/ui`)

| Setting | Value |
|---|---|
| Framework | SolidJS 1.9 (jsxImportSource: `solid-js`) |
| Build tool | Vite 7.1 |
| TypeScript | strict, ESNext target, bundler module resolution |
| Plugins | `vite-plugin-solid`, `vite-plugin-icons-spritesheet` (generates file-type + provider icon sprites) |
| Exports | `@diveeoi/ui/*` → `./src/components/*.tsx`, `@diveeoi/ui/v2/*` → `./src/v2/components/*.tsx`, `@diveeoi/ui/context/*`, `@diveeoi/ui/hooks`, `@diveeoi/ui/styles`, `@diveeoi/ui/theme/*`, `@diveeoi/ui/pierre/*` |

---

## Entry Points

### App

**`index.html`**: Mount target `<div id="root">`, loads `/src/entry.tsx`.

**`src/entry.tsx`** — Bootstrap order:
1. Sentry init (if DSN configured)
2. Create `Platform` object (web platform: notifications, localStorage, window history)
3. Compute auth token from URL param or env vars
4. Creates `ServerConnection.Http`
5. Renders: `PlatformProvider > AppBaseProviders > AppInterface`

**`src/entry.tsx` + `src/app.tsx`** — Provider tree (outer to inner):
```
[entry.tsx]
PlatformProvider
  > AppBaseProviders [app.tsx]
      MetaProvider > Font > ThemeProvider > LanguageProvider > UiI18nBridge >
        ErrorBoundary > QueryProvider > WslServersProvider > DialogProvider >
          MarkedProvider > FileComponentProvider
            > AppInterface
                ServerProvider > GlobalProvider > ConnectionGate
                  > Router root: TabsProvider > ServerShell
                      > QueryProvider > SharedProviders
                          > SettingsProvider > CommandProvider > HighlightsProvider
                            > [route layouts]

[SelectedServerLayout — /, /:dir, /:dir/session/:id?]
  ServerKey > ServerSDKProvider > ServerSyncProvider
    > ServerScopedShell
        > PermissionProvider > LayoutProvider > NotificationProvider
          > ModelsProvider > Layout
              > [/:dir gateway: SDKProvider > DirectoryDataProvider > LocalProvider]
                  > [HomePage]
                  > [SessionPage: SessionProviders]
                      > TerminalProvider > FileProvider > PromptProvider > CommentsProvider

[DraftServerLayout — /new-session]
  ServerSDKProvider > ServerSyncProvider
    > ServerScopedShell
        > PermissionProvider > LayoutProvider > NotificationProvider
          > ModelsProvider > Layout
              > DraftRoute: SDKProvider > DirectoryDataProvider
                  > DraftProviders: FileProvider > PromptProvider > CommentsProvider
```

### UI

No standalone entry — imported by app via `@diveeoi/ui/*`. Each component is a self-contained module with a co-located `.css` file.

Entry for styles: `@diveeoi/ui/styles` → `src/styles/index.css` (layered: theme, base, components, utilities).

---

## Component Map

### App Components (`packages/app/src/components/`)

| Component | File | Props Summary | Primitives | Used By |
|---|---|---|---|---|
| `PromptInput` | `prompt-input.tsx` | `{ editorType, contextTools, ... }` | SolidJS + @diveeoi/ui/* | SessionPage, NewSessionPage |
| `Titlebar` | `titlebar.tsx` | `{ update? }` | SolidJS | Layout page |
| `DialogSettings` | `dialog-settings.tsx` | — | @diveeoi/ui/dialog | Layout page |
| `DialogSelectModel` | `dialog-select-model.tsx` | `{ ... }` | @diveeoi/ui/* | Session, Settings |
| `DialogSelectProvider` | `dialog-select-provider.tsx` | — | @diveeoi/ui/* | Settings |
| `DialogSelectServer` | `dialog-select-server.tsx` | — | @diveeoi/ui/* | Home, Layout |
| `DialogSelectDirectory` | `dialog-select-directory.tsx` | — | @diveeoi/ui/* | Home |
| `DialogSelectFile` | `dialog-select-file.tsx` | — | @diveeoi/ui/* | Session |
| `DialogSelectMCP` | `dialog-select-mcp.tsx` | — | @diveeoi/ui/* | Settings |
| `DialogManageModels` | `dialog-manage-models.tsx` | — | @diveeoi/ui/* | Settings |
| `DialogFork` | `dialog-fork.tsx` | — | @diveeoi/ui/* | Session |
| `DialogReleaseNotes` | `dialog-release-notes.tsx` | — | @diveeoi/ui/* | HighlightsProvider |
| `DialogEditProject` | `dialog-edit-project.tsx` | — | @diveeoi/ui/* | Layout |
| `DialogUsageExceeded` | `dialog-usage-exceeded.tsx` | — | @diveeoi/ui/* | Session |
| `DialogCustomProvider` | `dialog-custom-provider.tsx` | — | @diveeoi/ui/* | Settings |
| `DialogConnectProvider` | `dialog-connect-provider.tsx` | — | @diveeoi/ui/* | Settings |
| `DialogSelectDirectoryV2` | `dialog-select-directory-v2.tsx` | — | @diveeoi/ui/v2/* | Home |
| `FileTree` | `file-tree.tsx` | — | @diveeoi/ui/* | SessionSidePanel |
| `Terminal` | `terminal.tsx` | `{ ... }` | SolidJS + websocket | TerminalPanel |
| `StatusPopover` | `status-popover.tsx` | — | @diveeoi/ui/* | Layout |
| `StatusPopoverBody` | `status-popover-body.tsx` | — | @diveeoi/ui/* | StatusPopover |
| `HelpButton` | `help-button.tsx` | — | @diveeoi/ui/* | Layout |
| `DebugBar` | `debug-bar.tsx` | — | SolidJS | Dev only |
| `DirectoryPicker` | `directory-picker.tsx` | — | @diveeoi/ui/* | Home |
| `ModelTooltip` | `model-tooltip.tsx` | — | @diveeoi/ui/* | Session |
| `SettingsGeneral` | `settings-general.tsx` | — | @diveeoi/ui/* | SettingsDialog |
| `SettingsKeybinds` | `settings-keybinds.tsx` | — | @diveeoi/ui/* | SettingsDialog |
| `SettingsModels` | `settings-models.tsx` | — | @diveeoi/ui/* | SettingsDialog |
| `SettingsProviders` | `settings-providers.tsx` | — | @diveeoi/ui/* | SettingsDialog |
| `SettingsServers` | `settings-servers.tsx` | — | @diveeoi/ui/* | SettingsDialog |
| `SettingsServerPicker` | `settings-server-picker.tsx` | — | @diveeoi/ui/* | SettingsDialog |
| `SettingsList` | `settings-list.tsx` | — | @diveeoi/ui/* | SettingsDialog |
| `ServerRowMenu` | `server/server-row-menu.tsx` | — | @diveeoi/ui/* | Layout |
| `ServerHealthIndicator` | `server/server-row.tsx` | — | @diveeoi/ui/* | Layout |
| `SessionHeader` | `session/session-header.tsx` | — | @diveeoi/ui/* | SessionPage |
| `SessionSortableTab` | `session/session-sortable-tab.tsx` | — | @diveeoi/ui/* | SessionPage |
| `SessionSortableTerminalTab` | `session/session-sortable-terminal-tab.tsx` | — | @diveeoi/ui/* | TerminalPanel |
| `NewSessionView` | `session/new-session-view.tsx` | — | @diveeoi/ui/* | SessionPage |
| `SessionContextUsage` | `session-context-usage.tsx` | — | @diveeoi/ui/* | SessionPage |
| `UpdaterAction` | `updater-action.ts` | — | SolidJS | Layout |
| `Link` | `link.tsx` | — | SolidJS | Various |
| `WindowsAppMenu` | `windows-app-menu.tsx` | — | @diveeoi/ui/* | Desktop only |
| `TitlebarHistory` | `titlebar-history.ts` | — | SolidJS | Titlebar |
| `TitlebarSessionEvents` | `titlebar-session-events.ts` | — | SolidJS | Titlebar |

### UI V1 Components — Key Pattern

All v1 components use `data-component` + `data-slot` attribute selectors for CSS (no BEM, no Tailwind utility classes in component CSS). They wrap `@kobalte/core` primitives for accessibility. Co-located `.css` files import into `@layer components` in `styles/index.css`.

| Component | File | Props | Primitive | `data-component` | Slots |
|---|---|---|---|---|---|
| `Button` | `button.tsx` | `{ size, variant, icon }` | `@kobalte/core/button` | `button` | `icon-svg` |
| `Dialog` | `dialog.tsx` | `{ title, description, action, size, fit }` | `@kobalte/core/dialog` | `dialog` | container, content, header, title, close-button, description, body |
| `Tabs` | `tabs.tsx` | `{ variant, orientation }` (compound) | `@kobalte/core/tabs` | `tabs` | list, trigger-wrapper, trigger, close-button, content, section-title |
| `Select` | `select.tsx` | generic `{ options, current, value, label, groupBy }` | `@kobalte/core/select` | `select` | trigger, value, icon, section, item, item-label, item-indicator |
| `Checkbox` | `checkbox.tsx` | `{ hideLabel, description, icon }` | `@kobalte/core/checkbox` | `checkbox` | input, control, indicator, label, description, error |
| `Switch` | `switch.tsx` | `{ hideLabel, description }` | `@kobalte/core/switch` | `switch` | input, label, control, thumb, description, error |
| `TextField` | `text-field.tsx` | `{ label, variant, copyable, multiline }` | `@kobalte/core/text-field` | `input` | label, wrapper, input, copy-button, description, error |
| `Tooltip` | `tooltip.tsx` | `{ value, inactive, forceOpen }` | `@kobalte/core/tooltip` | `tooltip` | trigger, keybind, key |
| `Popover` | `popover.tsx` | `{ trigger, title, description, portal }` | `@kobalte/core/popover` | `popover` | trigger, arrow, header, title, close-button, description, body |
| `DropdownMenu` | `dropdown-menu.tsx` | 18 sub-components (compound) | `@kobalte/core/dropdown-menu` | `dropdown-menu` | trigger, icon, arrow, separator, group, item, sub-trigger, etc. |
| `ContextMenu` | `context-menu.tsx` | 18 sub-components (compound) | `@kobalte/core/context-menu` | `context-menu` | (same structure as DropdownMenu) |
| `Accordion` | `accordion.tsx` | compound (Item, Header, Trigger, Content) | `@kobalte/core/accordion` | `accordion` | item, header, trigger, content |
| `Collapsible` | `collapsible.tsx` | `{ variant }` (compound) | `@kobalte/core/collapsible` | `collapsible` | trigger, content, arrow, arrow-icon |
| `Card` | `card.tsx` | `{ variant }` + CardTitle/CardDescription/CardActions | native `<div>` | `card` | title, title-icon, description, actions |
| `List` | `list.tsx` | generic `{ search, add, divider, groupHeader }` | native + TextField | `list` | search-wrapper, search, scroll, empty-state, item, group, header |
| `Tag` | `tag.tsx` | `{ size }` | native `<span>` | `tag` | — |
| `Avatar` | `avatar.tsx` | `{ fallback, src, size }` | native `<div>` | `avatar` | image |
| `Icon` | `icon.tsx` | `{ name, size }` (105 icons) | SVG sprite | `icon` | svg |
| `Spinner` | `spinner.tsx` | `{ class, style }` | native SVG | `spinner` | — |
| `Markdown` | `markdown.tsx` | `{ text, cacheKey, streaming }` | marked + Shiki + morphdom | `markdown` | copy-button, block, key, hash |

### UI V2 Components — Key Differences from V1

V2 lives in `src/v2/components/`, uses `data-component="<name>-v2"` consistently, and has **new variant naming**:

| Concept | V1 | V2 |
|---|---|---|
| Button variant | `primary` / `secondary` / `ghost` | `neutral` / `contrast` / `ghost` / `ghost-muted` |
| Styling | Tailwind + CSS vars | Pure CSS attribute selectors + `--v2-*` semantic tokens |
| Compound pattern | Some components | Heavier use of `Object.assign` |
| Icon system | `icon.tsx` sprite (105 icons) | New `v2/icon.tsx` sprite (separate symbol set) |
| Color tokens | `--text-base`, `--surface-base` | `--v2-text-text-base`, `--v2-background-bg-base` |

V2 styles are self-contained in `v2/styles/` (`colors.css`, `theme.css`) and use `[data-color-scheme="light|dark"]` instead of media queries.

---

## Routing Table

Defined in `src/app.tsx:476-485` via `@solidjs/router`:

| Path | Page Component | Lazy? | Params | Provider Context |
|---|---|---|---|---|
| `/` | `Home` | Yes (`lazy`) | — | SelectedServerLayout |
| `/:dir` | ⇨ redirect to `/:dir/session` | — | `dir` (base64) | SelectedServerLayout |
| `/:dir/session` | `Session` (no id) | Yes (`lazy`) | `dir` | SelectedServerLayout + SessionProviders |
| `/:dir/session/:id` | `Session` (with id) | Yes (`lazy`) | `dir`, `id` | SelectedServerLayout + SessionProviders |
| `/new-session` | `NewSession` | Via `DraftRoute` resolver | `draftId` (query) | DraftServerLayout + DraftProviders |

Lazy loading via `lazy(() => import("@/pages/home"))` pattern. All routes except `/` require an active server connection (gated by `ConnectionGate`).

---

## State & Data Flow

### Context/Store Map (App)

| Context | File | Key State | Provided By | Consumers |
|---|---|---|---|---|
| `Platform` | `platform.tsx` | `platform` name, version, notification/location/storage APIs | `entry.tsx` (wraps entire app) | ~30 files |
| `Language` | `language.tsx` | `locale`, `intl`, `dict`, `t()` | `AppBaseProviders` | ~70 files |
| `Settings` | `settings.tsx` | `general`, `appearance`, `keybinds`, `permissions` | `SharedProviders` | ~30 files |
| `Command` | `command.tsx` | command registration, keybind map, palette | `Settings > CommandProvider` | ~15 files |
| `Highlights` | `highlights.tsx` | version changelog seen-state | `Command > HighlightsProvider` | Internal dialog |
| `Server` | `server.tsx` | connection list, active key, projects | `AppInterface > ServerProvider` | ~20 files |
| `Global` | `global.tsx` | per-server contexts (queryClient, sync) | `ServerProvider > GlobalProvider` | ~10 files |
| `Tabs` | `tabs.tsx` | session/draft tabs (persisted) | `Router root > TabsProvider` | ~8 files |
| `ServerSDK` | `server-sdk.tsx` | SDK client, SSE event stream | `SelectedServerLayout` / `DraftServerLayout` | ~15 files |
| `ServerSync` | `server-sync.tsx` | global store (providers, projects, sessions) | `ServerSDK > ServerSyncProvider` | ~20 files |
| `Layout` | `layout.tsx` | sidebar, terminal, review, fileTree panels (persisted) | `ServerScopedShell > LayoutProvider` | ~20 files |
| `Notification` | `notification.tsx` | session/project notifications (persisted) | `Layout > NotificationProvider` | ~6 files |
| `Models` | `models.tsx` | model visibility, recent, variant (persisted) | `Notification > ModelsProvider` | ~6 files |
| `Permission` | `permission.tsx` | auto-accept rules (persisted) | `ServerScopedShell > PermissionProvider` | ~10 files |
| `SDK` | `sdk.tsx` | directory-scoped SDK client | `DirectoryLayout` / `DraftRoute` | ~10 files |
| `Local` | `local.tsx` | per-session agent/model (persisted) | `DirectoryDataProvider > LocalProvider` | ~8 files |
| `Terminal` | `terminal.tsx` | workspace PTY list | `SessionProviders > TerminalProvider` | ~8 files |
| `File` | `file.tsx` | file content cache, tree state, view cache | `Session/Draft > FileProvider` | ~12 files |
| `Prompt` | `prompt.tsx` | prompt text, context items | `File > PromptProvider` | ~10 files |
| `Comments` | `comments.tsx` | line comments per session (persisted) | `Prompt > CommentsProvider` | ~6 files |

### UI Contexts

| Context | File | Key State | Provided By | Consumers |
|---|---|---|---|---|
| `DialogProvider` | `context/dialog.tsx` | global dialog queue | `AppBaseProviders` | Any component |
| `I18nProvider` | `context/i18n.tsx` | locale + translator | `AppBaseProviders > UiI18nBridge` | UI components |
| `FileComponentProvider` | `context/file.tsx` | injects file renderer component | `AppBaseProviders` | SessionReview, etc. |
| `MarkedProvider` | `context/marked.tsx` | markdown parser config | `AppBaseProviders` | Markdown |
| `DataProvider` | `context/data.tsx` | directory data (projects, sessions) | `DirectoryDataProvider` | ContextMenu, etc. |
| `Helper` | `context/helper.tsx` | helper utilities | `AppBaseProviders` | Internal |
| `WorkerPool` | `context/worker-pool.tsx` | Shiki web worker pool | `AppBaseProviders` | Markdown |

### Data Flow

```
User Action → Component
  → Context Hook (useSettings, useTabs, etc.)
    → Store update (SolidJS createStore / persisted)
      → ServerSDK / ServerSync (SSE event stream)
        → Backend (via HTTP client or WebSocket)
          ↓
Component ← Store ← Response

Session data flow:
  ServerSync SSE events → event-reducer.ts → global-sync stores
    → child(dir) store (per-directory)
      → DirectoryDataProvider
        → SessionPage reads via useSync().session.*

API Layer:
  - HTTP client: ServerSDK creates from ServerConnection (url + auth)
  - Auth: Basic auth header (base64 username:password) or token from URL param
  - Query: @tanstack/solid-query (QueryClient with refetchOnMount: false, refetchOnWindowFocus: false)
  - Cache: global-sync session cache with LRU eviction, session prefetch
```

---

## Key Dependencies

### App (`@diveeoi/app`)

| Package | Version | Purpose |
|---|---|---|
| `solid-js` | ^1.9 | UI framework |
| `@solidjs/router` | catalog | Client-side routing |
| `@kobalte/core` | catalog | Headless accessible primitives |
| `@tanstack/solid-query` | 5.91.4 | Server state / data fetching |
| `@tanstack/solid-virtual` | catalog | Virtual scrolling |
| `@diveeoi/db` | workspace:* | Shared DB utils, encoding |
| `@diveeoi/sdk` | workspace:* | API client SDK |
| `@diveeoi/ui` | workspace:* | Shared UI components |
| `@solid-primitives/*` | various | SolidJS utilities (i18n, media, storage, etc.) |
| `@thisbeyond/solid-dnd` | 0.7.5 | Drag-and-drop |
| `marked` + `shiki` | catalog | Markdown parsing + syntax highlighting |
| `effect` | catalog | Effect-TS (used in server utils) |
| `luxon` | catalog | Date/time manipulation |
| `diff` | catalog | Text diff computation |
| `fuzzysort` | catalog | Fuzzy search |
| `tailwindcss` | catalog | Utility CSS framework |
| `@sentry/solid` | catalog | Error tracking |

### UI (`@diveeoi/ui`)

| Package | Version | Purpose |
|---|---|---|
| `solid-js` | ^1.9 | UI framework |
| `@kobalte/core` | catalog | Headless accessible primitives |
| `@diveeoi/db` | workspace:* | Shared DB utils |
| `@diveeoi/sdk` | workspace:* | API client SDK |
| `@pierre/diffs` | catalog | Web component diff/code renderer |
| `marked` + `shiki` | catalog | Markdown parsing + Shiki highlighting |
| `morphdom` | 2.7.8 | DOM diffing for markdown updates |
| `dompurify` | 3.3.1 | HTML sanitization |
| `katex` | 0.16.27 | Math rendering |
| `motion` | 12.34.5 | Animation library |
| `diff` | catalog | Text diff computation |
| `fuzzysort` | catalog | Fuzzy search |
| `tailwindcss` | catalog | Utility CSS framework |
| `luxon` | catalog | Date/time |

---

## Styling System

### CSS Architecture (layered `@layer` cascade)

```css
@layer theme, base, components, utilities;
```

| Layer | Contents | Source |
|---|---|---|
| `theme` | CSS custom properties (colors, typography, shadows, spacing) | `src/styles/theme.css` + resolved theme tokens |
| `base` | CSS reset, HTML defaults, katex | `src/styles/base.css` |
| `components` | ~50 per-component `.css` files (v1) + v2 CSS | `src/components/*.css`, `src/v2/components/*.css` |
| `utilities` | Utility classes, keyframe animations | `src/styles/utilities.css`, `src/styles/animations.css` |

### Key Patterns

- **V1 components**: `data-component`, `data-variant`, `data-size`, `data-slot` attribute selectors. Refer to `var(--text-base)`, `var(--surface-base)`, etc.
- **V2 components**: Same pattern but with `--v2-*` custom properties. `data-color-scheme="light|dark"` for mode switching.
- **Theme system**: Oklch color engine generates ~200 CSS custom properties from 7-11 seed colors. 38 built-in themes.
- **Tailwind**: Used for utility classes in app components. All CSS vars mapped to `--color-*` tokens so `bg-background-base` etc. work.
- **V2 styles**: `v2/styles/colors.css` (raw tokens) + `v2/styles/theme.css` (semantic mappings). No Tailwind dependency in v2 CSS.
- **Animations**: CSS `@keyframes` for popover/dialog/hover-card open/close. CSS `scroll-timeline` for sticky headers.

---

## Testing Setup

| Aspect | App (`@diveeoi/app`) | UI (`@diveeoi/ui`) |
|---|---|---|
| Framework | Bun test + Playwright (e2e) | Bun test |
| Unit test runner | `bun test` (happy-dom preload) | `bun test src` |
| E2E | Playwright (`packages/app/e2e/`) | — |
| Test convention | `*.test.ts` / `*.test.tsx` co-located with source | Same |
| Preload | `happydom.ts` (happy-dom global registration) | — |
| Browser tests | `test-browser/` (solid-virtual) | — |

Commands:
- `bun test` (app): runs unit + virtualizer tests
- `bun run test:e2e` (app): runs Playwright e2e
- `bun test` (ui): runs UI unit tests

---

## Scripts & Commands

### App (`packages/app/package.json`)

| Command | What It Does |
|---|---|
| `bun dev` | Start Vite dev server (default port 3000, but use 4444 for local dev) |
| `bun run build` | Production build via Vite |
| `bun run serve` | Preview production build |
| `bun test` | Run unit + virtualizer tests |
| `bun test:unit` | Run unit tests (happy-dom) |
| `bun run test:e2e` | Run Playwright e2e tests |
| `bun run typecheck` | TypeScript type checking (tsgo, memory-limited) |

### UI (`packages/ui/package.json`)

| Command | What It Does |
|---|---|
| `bun dev` | Start Vite dev server (port 3001) |
| `bun test` | Run unit tests |
| `bun run typecheck` | TypeScript type checking (tsgo) |
| `bun run generate:tailwind` | Generate Tailwind color token mappings |
| `bun run generate:v2-oc2` | Generate v2 OC-2 theme overrides |

---

## Quick Reference

| Task | File(s) |
|---|---|
| Add a new page/route | Edit `src/app.tsx` (Route definitions), create page in `src/pages/` |
| Add a new UI component (v1) | Create `packages/ui/src/components/<name>.tsx` + `<name>.css`, export via `package.json` exports |
| Add a new UI component (v2) | Create `packages/ui/src/v2/components/<name>-v2.tsx` + `<name>-v2.css`, import via `@diveeoi/ui/v2/<name>-v2` |
| Modify the app layout/sidebar | Edit `src/pages/layout.tsx` and `src/pages/layout/` |
| Modify the home page | Edit `src/pages/home.tsx` |
| Modify the session/chat page | Edit `src/pages/session.tsx` and `src/pages/session/` |
| Modify the prompt composer | Edit `src/pages/session/composer/` or `src/components/prompt-input.tsx` |
| Change the theme engine | Edit `packages/ui/src/theme/` (context.tsx, resolve.ts, color.ts) |
| Add a new theme | Create JSON in `packages/ui/src/theme/themes/`, register in `default-themes.ts` |
| Modify global styles | Edit `packages/ui/src/styles/theme.css` or `packages/ui/src/styles/tailwind/index.css` |
| Change a v1 component's CSS | Edit `packages/ui/src/components/<name>.css` (co-located) |
| Change a v2 component's CSS | Edit `packages/ui/src/v2/components/<name>-v2.css` |
| Modify a v1 component's behavior | Edit `packages/ui/src/components/<name>.tsx` |
| Modify a v2 component's behavior | Edit `packages/ui/src/v2/components/<name>-v2.tsx` |
| Change an API call | Edit `src/context/server-sdk.tsx` (HTTP client) or `src/context/server-sync.tsx` (SSE events) |
| Add a context/store | Create file in `src/context/`, integrate in `src/app.tsx` provider tree |
| Modify settings | Edit `src/context/settings.tsx` (store), `src/components/dialog-settings.tsx` (UI) |
| Modify session state | Edit `src/context/tabs.tsx` (tab management), `src/pages/session/` |
| Add i18n strings (app) | Edit `src/i18n/en.ts` (and other locales) |
| Add i18n strings (UI) | Edit `packages/ui/src/i18n/en.ts` (and other locales) |
| Modify the file/diff viewer | Edit `packages/ui/src/pierre/` or `packages/ui/src/components/file.tsx` |
| Modify the markdown renderer | Edit `packages/ui/src/components/markdown.tsx` |
| Find a test for ComponentX | Look for `*.test.ts` next to the source file |
| Add an E2E test | Create in `packages/app/e2e/` |
| Run the full test suite | `bun test` (app unit) + `bun run test:e2e` (app e2e) + `bun test` (ui) |
| Modify Tailwind config | Edit `packages/ui/src/styles/tailwind/` (Tailwind CSS 4, no JS config) |
| Add a new environment variable | Add to `.env`, define in `vite.config.ts` `define` block |
| Migrate a v1 component to v2 | Create `packages/ui/src/v2/components/<name>-v2.tsx`, style with `data-component` + `--v2-*` tokens |
| Check types across all packages | `bun turbo typecheck` (from monorepo root) |

---

## Component Contribution Guide

### Adding a new v1 UI component

1. Create `<name>.tsx` and `<name>.css` in `packages/ui/src/components/`
2. Use `@kobalte/core` primitives for accessible interactive elements
3. Use `splitProps` pattern: separate local props from rest/spread props
4. Apply `data-component="<name>"` on the root element, `data-slot="<part>"` on children
5. Use `var(--*)` CSS custom properties for all colors — never hardcode
6. Add the `.css` import to `packages/ui/src/styles/index.css`
7. Add the export to `packages/ui/package.json` exports map
8. Test the component in its `.stories.tsx` and `*.test.tsx`

### Adding a new v2 UI component

1. Create `<name>-v2.tsx` and `<name>-v2.css` in `packages/ui/src/v2/components/`
2. Use `data-component="<name>-v2"` on root, `data-slot="<name>-v2-<part>"` on children
3. Use `--v2-*` semantic tokens for colors (see `v2/styles/theme.css`)
4. Support `[data-color-scheme="light|dark"]` for theme switching
5. Use Kobalte primitives where applicable (SegmentedControlV2 is the only fully custom component)
6. Compound components: use `Object.assign(Root, { PartA, PartB })` pattern
7. Import `@diveeoi/ui/v2/<name>` in consumer code

### Adding a new app component

1. Create the component in `packages/app/src/components/`
2. Use `@diveeoi/ui/*` or `@diveeoi/ui/v2/*` for shared UI primitives
3. Use `@diveeoi/ui/context/*` for dialog/marked/file contexts
4. Use `@/*` alias for app-internal imports
5. Use Tailwind utility classes (with `--v2-*` or `--*` CSS var references)
6. If it needs state, consume an existing context or create a new one in `src/context/`

### Adding a new route

1. Add the lazy import and `<Route>` definition in `src/app.tsx` `AppInterface`
2. Place the route inside `SelectedServerLayout` (server-gated) or `DraftServerLayout`
3. Create the page component in `src/pages/`
4. Add auth gating: routes under `SelectedServerLayout` require `server.key`

### Adding a new context/store

1. Create the store file in `src/context/` following the `createSimpleContext` pattern
2. Create a `use<Name>` hook returning store accessors + actions
3. Integrate the provider in the correct nest level in `src/app.tsx`
4. If data should survive navigation, persist via the `persisted` utility
5. Server-scoped contexts go in `ServerScopedShell`, session-scoped go in `SessionProviders`/`DraftProviders`
