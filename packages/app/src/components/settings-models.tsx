import { useFilteredList } from "@diveeoi/ui/hooks"
import { Button } from "@diveeoi/ui/button"
import { ProviderIcon } from "@diveeoi/ui/provider-icon"
import { Switch } from "@diveeoi/ui/switch"
import { Icon } from "@diveeoi/ui/icon"
import { IconButton } from "@diveeoi/ui/icon-button"
import { TextField } from "@diveeoi/ui/text-field"
import { type Component, For, Show, createSignal, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { popularProviders } from "@/hooks/use-providers"
import { SettingsList } from "./settings-list"
import { SettingsServerPicker, SettingsServerScope } from "./settings-server-picker"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

const ListLoadingState: Component<{ label: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.label}</span>
    </div>
  )
}

const ListEmptyState: Component<{ message: string; filter: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.message}</span>
      <Show when={props.filter}>
        <span class="text-14-regular text-text-strong mt-1">&quot;{props.filter}&quot;</span>
      </Show>
    </div>
  )
}

export const SettingsModels: Component = () => {
  return (
    <SettingsServerScope>
      <SettingsModelsContent />
    </SettingsServerScope>
  )
}

const SettingsModelsContent: Component = () => {
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
    })
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
      const result = await serverSDK().client.config.removeComposerKey({ directory: serverSync().data.path.directory })
      await serverSync().refreshProviders()
      setAAKeyConfigured(result.data?.configured ?? false)
      setAAKey("")
      showToast({ variant: "success", icon: "circle-check", title: "Saved Artificial Analysis key removed" })
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
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.models.title")}</h2>
            <SettingsServerPicker />
          </div>
          <div class="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-base">
            <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
            <TextField
              variant="ghost"
              type="text"
              value={list.filter()}
              onChange={list.onInput}
              placeholder={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="flex-1"
            />
            <Show when={list.filter()}>
              <IconButton icon="circle-x" variant="ghost" onClick={list.clear} />
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <section class="flex flex-col gap-3" aria-label="DiveeComposer settings">
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong">DiveeComposer</h3>
            <p class="text-12-regular text-text-weak leading-5">
              Automatically routes to free, reachable models using provider metadata and, when available, measurements
              from{" "}
              <a
                href="https://artificialanalysis.ai/"
                target="_blank"
                rel="noreferrer"
                class="text-text-strong underline underline-offset-2"
              >
                Artificial Analysis
              </a>
              .
            </p>
          </div>
          <SettingsList>
            <div class="flex flex-wrap items-start justify-between gap-4 py-4 border-b border-border-weak-base last:border-none sm:flex-nowrap sm:items-center">
              <div class="min-w-0 flex-1">
                <span class="text-14-medium text-text-strong block">Use all configured providers</span>
                <span class="text-12-regular text-text-weak leading-5 block">
                  Include free models from every connected provider, not just OpenCode. Models must pass the quality,
                  context-fit, and health checks.
                </span>
              </div>
              <Switch
                checked={composer().use_all_providers ?? true}
                onChange={(checked) => updateComposer({ use_all_providers: checked })}
                hideLabel
              >
                Use all configured providers
              </Switch>
            </div>
            <div class="flex flex-wrap items-start justify-between gap-4 py-4 border-b border-border-weak-base last:border-none sm:flex-nowrap sm:items-center">
              <div class="min-w-0 flex-1">
                <span class="text-14-medium text-text-strong block">
                  Allow local ranking without Artificial Analysis
                </span>
                <span class="text-12-regular text-text-weak leading-5 block">
                  By enabling this, you acknowledge that Composer will estimate model quality from catalog metadata,
                  model-family and variant hints, capabilities, context limits, release dates, and successful turns when
                  no benchmark measurement is available. These estimates can be less accurate and answers may be weaker
                  or less consistent than benchmark-backed selection.
                </span>
              </div>
              <Switch
                checked={composer().allow_unmeasured_ranking ?? false}
                onChange={(checked) => updateComposer({ allow_unmeasured_ranking: checked })}
                hideLabel
              >
                Allow local ranking without Artificial Analysis
              </Switch>
            </div>
            <p class="text-12-regular text-text-weak leading-5">
              The Artificial Analysis key is optional. Without matching measurements, Composer will only use local
              catalog-based estimates when the acknowledgement above is enabled.
            </p>
            <div class="flex flex-col gap-3 py-4 border-b border-border-weak-base">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="text-14-medium text-text-strong">Artificial Analysis API key</span>
                <Show when={aaKeyConfigured()}>
                  <span class="text-12-medium text-text-weak">API key configured</span>
                </Show>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <TextField
                  type="password"
                  value={aaKey()}
                  onChange={setAAKey}
                  placeholder={aaKeyConfigured() ? "Enter a key to replace the current setting" : "Paste your API key"}
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="new-password"
                  autocapitalize="off"
                  class="flex-1 min-w-[240px]"
                />
                <Button size="large" onClick={() => void saveAAKey()} disabled={!aaKey().trim() || savingAAKey()}>
                  {savingAAKey() ? "Saving..." : aaKeyConfigured() ? "Replace key" : "Save key"}
                </Button>
                <Show when={aaKeyConfigured()}>
                  <Button size="large" variant="ghost" onClick={() => void removeAAKey()}>
                    Remove
                  </Button>
                </Show>
              </div>
              <p class="text-12-regular text-text-weak leading-5">
                A key entered here is encrypted on the server. The browser only receives a configured flag, never the
                key itself.
              </p>
              <div class="flex flex-col gap-2 pt-2">
                <span class="text-14-medium text-text-strong">Fallback environment variable</span>
                <div class="flex flex-wrap items-center gap-2">
                  <TextField
                    type="text"
                    value={aaKeyEnv()}
                    onChange={setAAKeyEnv}
                    placeholder="ARTIFICIAL_ANALYSIS_API_KEY"
                    spellcheck={false}
                    autocorrect="off"
                    autocomplete="off"
                    autocapitalize="off"
                    class="flex-1 min-w-[240px]"
                  />
                  <Button
                    size="large"
                    variant="ghost"
                    onClick={() =>
                      updateComposer({
                        artificial_analysis_api_key_env: aaKeyEnv().trim() || "ARTIFICIAL_ANALYSIS_API_KEY",
                      })
                    }
                  >
                    Apply environment variable
                  </Button>
                </div>
              </div>
              <p class="text-12-regular text-text-weak leading-5">
                Optional environment-variable fallback. The encrypted Settings key takes precedence over this variable.
              </p>
            </div>
          </SettingsList>
        </section>
        <Show
          when={!list.grouped.loading}
          fallback={
            <ListLoadingState label={`${language.t("common.loading")}${language.t("common.loading.ellipsis")}`} />
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={<ListEmptyState message={language.t("dialog.model.empty")} filter={list.filter()} />}
          >
            <For each={list.grouped.latest}>
              {(group) => (
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2 pb-2">
                    <ProviderIcon id={group.category} class="size-5 shrink-0 icon-strong-base" />
                    <span class="text-14-medium text-text-strong">{group.items[0].provider.name}</span>
                  </div>
                  <SettingsList>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        return (
                          <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                            <div class="min-w-0 flex-1">
                              <span class="text-14-regular text-text-strong truncate block">{item.name}</span>
                            </div>
                            <div class="flex-shrink-0">
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
                          </div>
                        )
                      }}
                    </For>
                  </SettingsList>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}
