import { Switch } from "@diveeoi/ui/v2/switch-v2"
import { For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { FEATURE_ROWS, createFeaturesSettings } from "../settings-features-shared"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

export const SettingsFeaturesV2: Component = () => {
  const language = useLanguage()
  const settings = createFeaturesSettings()

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.tab.features")}</h2>
        </div>
        <p class="text-12-regular text-text-weak">{language.t("settings.features.notice")}</p>
      </div>

      <div class="settings-v2-tab-body">
        <Show when={settings.state.loadError} fallback={<Show when={!settings.state.loading}>
          <h3 class="settings-v2-section-title">{language.t("settings.features.section.features")}</h3>
          <SettingsListV2>
            <For each={FEATURE_ROWS}>
              {(row) => (
                <SettingsRowV2
                  title={row.title}
                  description={settings.envDisabled(row.key) ? language.t("settings.features.envDisabled") : row.description}
                >
                  <Switch
                    checked={!settings.envDisabled(row.key) && settings.state.features[row.key]}
                    disabled={settings.envDisabled(row.key)}
                    onChange={(checked) => settings.toggleFeature(row.key, checked)}
                  />
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>

          <h3 class="settings-v2-section-title">{language.t("settings.features.section.lsp")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.features.lsp.master")}
              description={language.t("settings.features.lsp.masterDescription")}
            >
              <Switch
                checked={settings.state.lspEnabled}
                disabled={settings.envDisabled("lsp") || !settings.state.features.lsp}
                onChange={(checked) => settings.toggleLspMaster(checked)}
              />
            </SettingsRowV2>
            <For each={settings.state.lspServers}>
              {(server) => (
                <SettingsRowV2
                  title={server.id}
                  description={server.extensions.join(", ")}
                >
                  <Switch
                    checked={!server.disabled}
                    disabled={!settings.state.lspEnabled || settings.envDisabled("lsp") || !settings.state.features.lsp}
                    onChange={(checked) => settings.toggleLspServer(server.id, !checked)}
                  />
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
        </Show>}>
          <div class="settings-v2-servers-status">
            <span>{settings.state.loadError || language.t("settings.features.loadFailed")}</span>
          </div>
        </Show>
        <Show when={settings.state.error}>
          <div class="settings-v2-servers-status">
            <span>{settings.state.error}</span>
          </div>
        </Show>
        <Show when={settings.state.restartFailed}>
          <div class="settings-v2-servers-status">
            <span>{language.t("settings.features.restartFailed")}</span>
          </div>
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
    </>
  )
}
