import { useFilteredList } from "@diveeoi/ui/hooks"
import { ProviderIcon } from "@diveeoi/ui/provider-icon"
import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { Switch } from "@diveeoi/ui/v2/switch-v2"
import { Icon as IconV2 } from "@diveeoi/ui/v2/icon"
import { IconButtonV2 } from "@diveeoi/ui/v2/icon-button-v2"
import { TextInputV2 } from "@diveeoi/ui/v2/text-input-v2"
import { type Component, For, Show, createSignal, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { popularProviders } from "@/hooks/use-providers"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

const PROVIDER_ICON_SIZE = 16

export const SettingsModelsV2: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [aaKey, setAAKey] = createSignal("")
  const [aaKeyConfigured, setAAKeyConfigured] = createSignal(false)
  const [savingAAKey, setSavingAAKey] = createSignal(false)
  const [aaKeyEnv, setAAKeyEnv] = createSignal("ARTIFICIAL_ANALYSIS_API_KEY")

  const composer = () => serverSync().data.config.performance?.composer ?? {}
  const updateComposer = (patch: Record<string, unknown>) => {
    const current = serverSync().data.config
    void serverSync().updateConfig({
      ...current,
      performance: {
        ...current.performance,
        composer: { ...current.performance?.composer, ...patch },
      },
    } as Record<string, unknown>)
  }

  onMount(() => {
    setAAKeyEnv(composer().artificial_analysis_api_key_env ?? "ARTIFICIAL_ANALYSIS_API_KEY")
    void serverSDK()
      .client.config.composerKeyStatus({ directory: serverSync().data.path.directory })
      .then((result) => setAAKeyConfigured(result.data?.configured ?? false))
      .catch(() => setAAKeyConfigured(false))
  })

  const saveAAKey = async () => {
    if (!aaKey().trim() || savingAAKey()) return
    setSavingAAKey(true)
    try {
      await serverSDK().client.config.setComposerKey({
        apiKey: aaKey(),
        directory: serverSync().data.path.directory,
      })
      await serverSync().refreshProviders()
      setAAKey("")
      setAAKeyConfigured(true)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Artificial Analysis key saved",
        description: "The key is encrypted on this server and is never returned to the browser.",
      })
    } catch (error) {
      showToast({
        title: "Could not save Artificial Analysis key",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSavingAAKey(false)
    }
  }

  const removeAAKey = async () => {
    try {
      const result = await serverSDK().client.config.removeComposerKey({
        directory: serverSync().data.path.directory,
      })
      await serverSync().refreshProviders()
      setAAKeyConfigured(result.data?.configured ?? false)
      setAAKey("")
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Saved Artificial Analysis key removed",
      })
    } catch (error) {
      showToast({
        title: "Could not remove Artificial Analysis key",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex

      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
    },
  })

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <h2 class="settings-v2-tab-title">{language.t("settings.models.title")}</h2>
        <div class="settings-v2-tab-search">
          <TextInputV2
            type="search"
            appearance="base"
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("dialog.model.search.placeholder")}
          />
          <Show when={list.filter()}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="settings-v2-tab-search-clear"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              onClick={() => list.clear()}
            />
          </Show>
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-models">
        <section class="settings-v2-section" data-component="settings-v2-composer">
          <h3 class="settings-v2-section-title">DiveeComposer</h3>
          <p class="text-13-regular text-text-weak">
            Routes only to free models from providers with usable credentials. Artificial Analysis measurements improve
            ranking, but the API key is optional.
          </p>
          <SettingsListV2>
            <SettingsRowV2
              title="Use all configured providers"
              description="Consider free models from all connected providers, not only OpenCode. Providers without usable authentication are skipped."
            >
              <Switch
                checked={composer().use_all_providers ?? true}
                onChange={(checked) => updateComposer({ use_all_providers: checked })}
                hideLabel
              >
                Use all configured providers
              </Switch>
            </SettingsRowV2>
            <SettingsRowV2
              title="Allow local ranking without Artificial Analysis"
              description="Consent to lower-confidence catalog estimates based on model family, variants, capabilities, context/output limits, release metadata, and successful turns. These estimates may select a weaker model."
            >
              <Switch
                checked={composer().allow_unmeasured_ranking ?? false}
                onChange={(checked) => updateComposer({ allow_unmeasured_ranking: checked })}
                hideLabel
              >
                Allow local ranking without Artificial Analysis
              </Switch>
            </SettingsRowV2>
            <SettingsRowV2
              title="Artificial Analysis API key"
              description={
                aaKeyConfigured()
                  ? "A key is configured and encrypted on the server. It is never sent back to the browser."
                  : "Optional. Add a key to use independent model-quality and performance measurements."
              }
            >
              <div class="flex flex-col gap-2 min-w-[250px]">
                <TextInputV2
                  type="password"
                  appearance="base"
                  value={aaKey()}
                  onInput={(event) => setAAKey(event.currentTarget.value)}
                  placeholder={aaKeyConfigured() ? "Enter a key to replace the current key" : "Paste API key"}
                  autocomplete="new-password"
                  spellcheck={false}
                  autocorrect="off"
                  autocapitalize="off"
                  aria-label="Artificial Analysis API key"
                />
                <div class="flex flex-wrap gap-2">
                  <ButtonV2 onClick={() => void saveAAKey()} disabled={!aaKey().trim() || savingAAKey()}>
                    {savingAAKey() ? "Saving…" : aaKeyConfigured() ? "Replace key" : "Save key"}
                  </ButtonV2>
                  <Show when={aaKeyConfigured()}>
                    <ButtonV2 variant="ghost-muted" onClick={() => void removeAAKey()}>
                      Remove
                    </ButtonV2>
                  </Show>
                </div>
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title="Fallback environment variable"
              description="Used only when no encrypted Settings key is stored. The encrypted key takes precedence."
            >
              <div class="flex flex-col gap-2 min-w-[250px]">
                <TextInputV2
                  type="text"
                  appearance="base"
                  value={aaKeyEnv()}
                  onInput={(event) => setAAKeyEnv(event.currentTarget.value)}
                  placeholder="ARTIFICIAL_ANALYSIS_API_KEY"
                  spellcheck={false}
                  autocorrect="off"
                  autocapitalize="off"
                  aria-label="Artificial Analysis API key environment variable"
                />
                <ButtonV2
                  variant="ghost-muted"
                  onClick={() =>
                    updateComposer({
                      artificial_analysis_api_key_env: aaKeyEnv().trim() || "ARTIFICIAL_ANALYSIS_API_KEY",
                    })
                  }
                >
                  Apply environment variable
                </ButtonV2>
              </div>
            </SettingsRowV2>
          </SettingsListV2>
          <p class="text-12-regular text-text-weak">
            Without a matching benchmark and while local ranking consent is disabled, DiveeComposer remains visible but
            requests are blocked until a measured route becomes available or you enable the local estimate.
          </p>
        </section>
        <Show
          when={!list.grouped.loading}
          fallback={
            <div class="settings-v2-models-status">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={
              <div class="settings-v2-models-status">
                <span>{language.t("dialog.model.empty")}</span>
                <Show when={list.filter()}>
                  <span class="settings-v2-models-status-filter">&quot;{list.filter()}&quot;</span>
                </Show>
              </div>
            }
          >
            <For each={list.grouped.latest}>
              {(group) => (
                <div class="settings-v2-section" data-component="settings-models-provider">
                  <div class="settings-v2-models-group-header">
                    <ProviderIcon
                      id={group.category}
                      width={PROVIDER_ICON_SIZE}
                      height={PROVIDER_ICON_SIZE}
                      class="settings-v2-models-provider-icon shrink-0"
                    />
                    <h3 class="settings-v2-section-title">{group.items[0].provider.name}</h3>
                  </div>
                  <SettingsListV2>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        return (
                          <SettingsRowV2 title={item.name} description="">
                            <div>
                              <Switch
                                checked={models.visible(key)}
                                onChange={(checked) => {
                                  models.setVisibility(key, checked)
                                }}
                                hideLabel
                              >
                                {item.name}
                              </Switch>
                            </div>
                          </SettingsRowV2>
                        )
                      }}
                    </For>
                  </SettingsListV2>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </>
  )
}
