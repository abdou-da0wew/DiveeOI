# @diveeoi/app

SolidJS single-page app. Built by Vite 7.1 with Tailwind 4.1 + Kobalte primitives, rendered to the same origin that hosts the server. Also the place where `GlobalPrefSync` (server-backed settings) lives.

## Entry

`src/entry.tsx` (182 lines) sets `DEFAULT_SERVER_URL_KEY = "diveeoi.settings.dat:defaultServerUrl"` behind `localStorage` try/catch, `getLocale` (`zh` prefix -> `zh` else `en`), `Platform` (web, `openLink/back/forward/restart`, `notify` via `Notification` gated on `visibilityState` + `hasFocus`), `getCurrentUrl` (`DEV ? VITE_DIVEEOI_SERVER_HOST:PORT : location.origin`), `authFromToken(?auth_token) ?? VITE_DIVEEOI_SERVER_PASSWORD`, and renders `PlatformProvider -> AppBaseProviders -> AppInterface{defaultServer, canonicalLocalServer, servers, disableHealthCheck}` into `#root`. `Sentry.init` filters `Breadcrumbs` (and `GlobalHandlers` in prod).

`src/app.tsx` (500 lines) holds the provider tree and the routes:

- `SessionRoute` handles the new-layout auto-draft (when `newLayoutDesigns && tabs.ready && sdk.directory` then `tabs.newDraft`).
- `SelectedServerLayout` is `ServerKey(selected) -> ServerSDKProvider -> ServerSyncProvider -> ServerScopedShell`.
- `DraftServerLayout` is resolved from `DraftTab.draftID` -> draft's target server. `DraftRoute` / `ResolvedDraftRoute` are the split between those two server identities.

The routes are:

```
Static:      /login, /register                               (outside ServerScopedShell)
Selected:    /           (HomeRoute)
             /:dir -> DirectoryLayout -> session/:id? (SessionRoute)
Draft:       /new-session?draftId=... -> DraftRoute -> ResolvedDraftRoute (NewSession)
```

A `Sentry` `ErrorBoundary` sits inside `AppBaseProviders` (below `LanguageProvider`), so i18n exists for error pages.

## Provider tree

```
AppBaseProviders
  MetaProvider + Font + ThemeProvider + LanguageProvider -> UiI18nBridge
  -> QueryProvider (react-query: refetchOnReconnect/Mount/WindowFocus all false)
  -> WslServersProvider + DialogProvider + MarkedProvider + FileComponentProvider

SharedProviders (server-agnostic, mounted once)
  SettingsProvider -> BodyDesignClass (font/classes toggle for newLayoutDesigns)
  -> CommandProvider -> HighlightsProvider

ServerScopedShell (per logical server, remounts on key change)
  PermissionProvider + LayoutProvider + NotificationProvider + ModelsProvider
  -> GlobalPrefSync -> Layout (tabs/sidebar + main)

SessionProviders (per opened session) -> TerminalProvider + FileProvider + PromptProvider + CommentsProvider
DraftProviders                            -> FileProvider   + PromptProvider + CommentsProvider
```

Persistence uses `@solid-primitives/storage` `persisted(Persist.global/scope(ServerScope...))` — so `projects` + `lastProject` in `packages/app/src/context/server.tsx` are scoped per logical server (`local|server.url` etc.). The `ServerProvider` shape is the map `StoredServer -> ServerConnection.Http|Sidecar|Ssh -> dedup -> Key=string&brand -> current + per-server `projects` stores.

## Components

`src/components/` holds 50+ domains:

- `prompt-input/*` — editor DOM, history, slash popover, drag overlay, attachment serialization (file/mcp/resource), Throttle on submit.
- `server/server-row.tsx`, `dialog-select-*` — server/model/provider/directory pickers, `directory-picker-domain` + `directory-picker-policy` (respect `config.command.agent`).
- `session/*` — `session-layout.ts`, `session-side-panel.tsx`, `terminal-panel.tsx`, `file-tabs.tsx`, `review-tab.tsx`, `composer/`, `timeline/`.
- `settings-v2/*` — `dialog-settings-v2.tsx` delegates to `GlobalPrefSync`; partitions `general/llm/models/providers/servers` inside `parts/list+row`.
- `titlebar.tsx` + `titlebar-session-events.ts` — health polling-aware busy messages.
- `global-pref-sync.tsx` — the sync bridge between local `createStore`+`createSimpleContext` (models, permissions) and `GET/PUT /api/prefs/:scope` (500ms debounce, `syncingFromServer` guard).

## State sync

`GlobalPrefSync` (see `packages/app/src/components/global-pref-sync.tsx:134 lines`) reads `sdk().scope` where available to route permissions to the server scope, otherwise global. Server wins on initial `GET`, local wins on `PUT` after debounce. The pattern reuses the legacy `SettingsPrefSync` shape. `packages/app/src/context/models.tsx` and `permission.tsx` expose `get value() { return store }` + `setStore` to let the sync component read and overwrite centrally.

## i18n

`src/i18n/` has dicts for `en, zh, zht, ja, ko, fr, de, es, pt-BR, ru, ar, ...`. The provider is `LanguageProvider` wrapping `I18nProvider` from `@diveeoi/ui`.

## Scripts

```bash
bun --cwd packages/app run dev            # vite --port 4444 in AGENTS notes; bare vite is port 3000
bun --cwd packages/app run typecheck      # systemd-run --scope tsgo -b
bun --cwd packages/app run build          # vite build -> dist/
bun --cwd packages/app run test           # bun test --preload happydom.ts + test-browser solid-virtual
bunx playwright install chromium
bun --cwd packages/app run test:e2e:local # playwright
# env for e2e:
# PLAYWRIGHT_SERVER_HOST/PORT (backend, default localhost:4096)
# PLAYWRIGHT_PORT (Vite, default 3000) / PLAYWRIGHT_BASE_URL
```

Frontend map: `packages/app/FRONTEND-MAP.md` is the file-level map (generated via `stitch::extract-design-md` etc., periodically stale).

## Layout toggle

`Settings.general.newLayoutDesigns()` toggles `BodyDesignClass` (`text-12-regular` vs `font-(family-name:...) text-[13px] font-[440]`). `SessionRoute` watches that flag to replace a `/session` with `/new-session?draftId=` autocreation when `newLayoutDesigns` is enabled.
