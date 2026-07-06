import { Show, type Component, createMemo } from "solid-js"
import { Switch } from "@diveeoi/ui/switch"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { ServerConnectionForm, ServerConnectionList, useServerManagementController } from "./dialog-select-server"
import { SettingsList } from "./settings-list"

type SettingsConfig = Record<string, unknown> & {
  builtin?: {
    ctx7?: { enabled?: boolean }
    context_mode?: { enabled?: boolean }
  }
}

export const SettingsServers: Component = () => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const controller = useServerManagementController()
  const config = createMemo(() => serverSync().data.config as SettingsConfig)
  const currentCtx7Enabled = createMemo(() => config()?.builtin?.ctx7?.enabled !== false)
  const currentContextModeEnabled = createMemo(() => config()?.builtin?.context_mode?.enabled !== false)

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col flex-1 min-h-0 max-w-[720px]">
        <Show
          when={controller.isFormMode()}
          fallback={
            <>
              <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
                <div class="flex flex-col gap-1 pt-6 pb-8">
                  <h2 class="text-16-medium text-text-strong">{language.t("status.popover.tab.servers")}</h2>
                </div>
              </div>

              <div class="flex flex-col gap-2 pb-4">
                <h3 class="text-14-medium text-text-strong px-4">Built-in Tools</h3>
                <SettingsList>
                  <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap px-4">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="text-14-medium text-text-strong">ctx7</span>
                      <span class="text-12-regular text-text-weak">Context retrieval tools (requires Upstash ctx7 API key)</span>
                    </div>
                    <div class="flex w-full justify-end sm:w-auto sm:shrink-0">
                      <Switch
                        checked={currentCtx7Enabled()}
                        onChange={(checked) => serverSync().updateConfig({ builtin: { ctx7: { enabled: checked } } } as Record<string, unknown>)}
                      />
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap px-4">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="text-14-medium text-text-strong">Context Mode</span>
                      <span class="text-12-regular text-text-weak">Built-in MCP server for context management</span>
                    </div>
                    <div class="flex w-full justify-end sm:w-auto sm:shrink-0">
                      <Switch
                        checked={currentContextModeEnabled()}
                        onChange={(checked) => serverSync().updateConfig({ builtin: { context_mode: { enabled: checked } } } as Record<string, unknown>)}
                      />
                    </div>
                  </div>
                </SettingsList>
              </div>

              <ServerConnectionList controller={controller} />
            </>
          }
        >
          <div class="flex flex-1 min-h-0 flex-col gap-4 pt-6">
            <div class="text-16-medium text-text-strong">{controller.formTitle()}</div>
            <ServerConnectionForm controller={controller} />
          </div>
        </Show>
      </div>
    </div>
  )
}
