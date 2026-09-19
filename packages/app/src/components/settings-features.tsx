import { Switch } from "@diveeoi/ui/switch"
import { For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { FEATURE_ROWS, createFeaturesSettings } from "./settings-features-shared"
import { SettingsList } from "./settings-list"

export const SettingsFeatures: Component = () => {
  const language = useLanguage()
  const settings = createFeaturesSettings()

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col flex-1 min-h-0 max-w-[720px]">
        <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
          <div class="flex flex-col gap-1 pt-6 pb-8">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.features")}</h2>
            <p class="text-12-regular text-text-weak">{language.t("settings.features.notice")}</p>
          </div>
        </div>

        <Show
          when={!settings.state.loadError}
          fallback={
            <div class="px-4 py-3 text-14-regular text-text-weak">
              {settings.state.loadError || language.t("settings.features.loadFailed")}
            </div>
          }
        >
          <div class="flex flex-col gap-2 pb-4">
            <h3 class="text-14-medium text-text-strong px-4">{language.t("settings.features.section.features")}</h3>
            <SettingsList>
              <For each={FEATURE_ROWS}>
                {(row) => (
                  <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap px-4">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="text-14-medium text-text-strong">{row.title}</span>
                      <span class="text-12-regular text-text-weak">
                        {settings.envDisabled(row.key) ? language.t("settings.features.envDisabled") : row.description}
                      </span>
                    </div>
                    <div class="flex w-full justify-end sm:w-auto sm:shrink-0">
                      <Switch
                        checked={!settings.envDisabled(row.key) && settings.state.features[row.key]}
                        disabled={settings.envDisabled(row.key)}
                        onChange={(checked) => settings.toggleFeature(row.key, checked)}
                      />
                    </div>
                  </div>
                )}
              </For>
            </SettingsList>
          </div>

          <div class="flex flex-col gap-2 pb-4">
            <h3 class="text-14-medium text-text-strong px-4">{language.t("settings.features.section.lsp")}</h3>
            <SettingsList>
              <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base sm:flex-nowrap px-4">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-14-medium text-text-strong">{language.t("settings.features.lsp.master")}</span>
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.features.lsp.masterDescription")}
                  </span>
                </div>
                <div class="flex w-full justify-end sm:w-auto sm:shrink-0">
                  <Switch
                    checked={settings.state.lspEnabled}
                    disabled={settings.envDisabled("lsp") || !settings.state.features.lsp}
                    onChange={(checked) => settings.toggleLspMaster(checked)}
                  />
                </div>
              </div>
              <For each={settings.state.lspServers}>
                {(server) => (
                  <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap px-4">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="text-14-medium text-text-strong">{server.id}</span>
                      <span class="text-12-regular text-text-weak">{server.extensions.join(", ")}</span>
                    </div>
                    <div class="flex w-full justify-end sm:w-auto sm:shrink-0">
                      <Switch
                        checked={!server.disabled}
                        disabled={!settings.state.lspEnabled || settings.envDisabled("lsp") || !settings.state.features.lsp}
                        onChange={(checked) => settings.toggleLspServer(server.id, !checked)}
                      />
                    </div>
                  </div>
                )}
              </For>
            </SettingsList>
          </div>

          <Show when={settings.state.error || settings.state.restartFailed}>
            <div class="px-4 py-3 text-14-regular text-text-weak">
              {settings.state.error || language.t("settings.features.restartFailed")}
            </div>
          </Show>
        </Show>
      </div>

      <Show when={settings.state.restarting}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="flex flex-col items-center gap-3 rounded-xl bg-surface-base px-8 py-6 shadow-lg">
            <span class="size-5 animate-spin rounded-full border-2 border-border-strong-base border-t-transparent" />
            <span class="text-14-medium text-text-strong">{language.t("settings.features.restarting")}</span>
          </div>
        </div>
      </Show>
    </div>
  )
}
