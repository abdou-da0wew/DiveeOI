import { Component, createMemo } from "solid-js"
import { Select } from "@diveeoi/ui/select"
import { Switch } from "@diveeoi/ui/switch"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { SettingsList } from "./settings-list"

export const SettingsLlm: Component = () => {
  const language = useLanguage()
  const serverSync = useServerSync()

  const config = createMemo(() => serverSync().data.config)

  const formatOptions = createMemo(() => [
    { value: "toon" as const, label: language.t("settings.llm.row.format.option.toon") },
    { value: "json" as const, label: language.t("settings.llm.row.format.option.json") },
  ])

  const currentFormat = createMemo(() => config().llm?.format ?? config().tool?.format ?? "toon")

  const burstStrategyOptions = createMemo(() => [
    { value: "truncate", label: "Truncate" },
    { value: "buffer", label: "Buffer" },
    { value: "abort", label: "Abort" },
  ])

  const burstActionOptions = createMemo(() => [
    { value: "warn", label: language.t("settings.llm.row.burstAction.option.warn") },
    { value: "truncate", label: "Truncate" },
    { value: "abort", label: "Abort" },
  ])

  const ToolFormatSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={language.t("settings.llm.row.format.title")}
          description={language.t("settings.llm.row.format.description")}
        >
          <Select
            data-action="settings-llm-format"
            options={formatOptions()}
            current={formatOptions().find((o) => o.value === currentFormat())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              if (option.value === currentFormat()) return
              serverSync().updateConfig({ llm: { ...(config().llm ?? {}), format: option.value } })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "180px" }}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const BurstSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.llm.section.burst")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.llm.row.burstMaxBytesPerSecond.title")}
          description={language.t("settings.llm.row.burstMaxBytesPerSecond.description")}
        >
          <div data-action="settings-llm-burst-bytes-per-second">
            <Switch
              checked={!!config().llm?.burst?.max_bytes_per_second}
              onChange={(checked) => {
                const current = config().llm?.burst ?? {}
                serverSync().updateConfig({
                  llm: {
                    ...(config().llm ?? {}),
                    burst: { ...current, max_bytes_per_second: checked ? 51200 : undefined },
                  },
                })
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.llm.row.burstStrategy.title")}
          description={language.t("settings.llm.row.burstStrategy.description")}
        >
          <Select
            data-action="settings-llm-burst-strategy"
            options={burstStrategyOptions()}
            current={burstStrategyOptions().find((o) => o.value === (config().llm?.burst?.strategy ?? "truncate"))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              const current = config().llm?.burst ?? {}
              serverSync().updateConfig({
                llm: { ...(config().llm ?? {}), burst: { ...current, strategy: option.value as "truncate" | "buffer" | "abort" } },
              })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.llm.row.burstAction.title")}
          description={language.t("settings.llm.row.burstAction.description")}
        >
          <Select
            data-action="settings-llm-burst-action"
            options={burstActionOptions()}
            current={burstActionOptions().find((o) => o.value === (config().llm?.burst?.action ?? "warn"))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              const current = config().llm?.burst ?? {}
              serverSync().updateConfig({
                llm: { ...(config().llm ?? {}), burst: { ...current, action: option.value as "warn" | "truncate" | "abort" } },
              })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const ToolOutputSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.llm.section.toolOutput")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.llm.row.maxToolOutputLines.title")}
          description={language.t("settings.llm.row.maxToolOutputLines.description")}
        >
          <div data-action="settings-llm-max-tool-output-lines">
            <Switch
              checked={!!config().llm?.tool_output?.max_lines}
              onChange={(checked) => {
                const current = config().llm?.tool_output ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), tool_output: { ...current, max_lines: checked ? 500 : undefined } },
                })
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.llm.row.maxToolOutputBytes.title")}
          description={language.t("settings.llm.row.maxToolOutputBytes.description")}
        >
          <div data-action="settings-llm-max-tool-output-bytes">
            <Switch
              checked={!!config().llm?.tool_output?.max_bytes}
              onChange={(checked) => {
                const current = config().llm?.tool_output ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), tool_output: { ...current, max_bytes: checked ? 25600 : undefined } },
                })
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.llm.row.maxToolOutput.title")}
          description={language.t("settings.llm.row.maxToolOutput.description")}
        >
          <div data-action="settings-llm-max-tool-output">
            <Switch
              checked={!!config().llm?.max_tool_output}
              onChange={(checked) => {
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), max_tool_output: checked ? 100000 : undefined },
                })
              }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const CompactionSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.llm.section.compaction")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.llm.row.compactAuto.title")}
          description={language.t("settings.llm.row.compactAuto.description")}
        >
          <div data-action="settings-llm-compact-auto">
            <Switch
              checked={config().llm?.compaction?.auto ?? true}
              onChange={(checked) => {
                const current = config().llm?.compaction ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), compaction: { ...current, auto: checked } },
                })
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.llm.row.compactPrune.title")}
          description={language.t("settings.llm.row.compactPrune.description")}
        >
          <div data-action="settings-llm-compact-prune">
            <Switch
              checked={config().llm?.compaction?.prune ?? false}
              onChange={(checked) => {
                const current = config().llm?.compaction ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), compaction: { ...current, prune: checked } },
                })
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.llm.row.compactTailTurns.title")}
          description={language.t("settings.llm.row.compactTailTurns.description")}
        >
          <div data-action="settings-llm-compact-tail-turns">
            <Switch
              checked={!!config().llm?.compaction?.tail_turns}
              onChange={(checked) => {
                const current = config().llm?.compaction ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), compaction: { ...current, tail_turns: checked ? 4 : undefined } },
                })
              }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const WorkflowSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.llm.section.workflow")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.llm.row.parallelToolCalls.title")}
          description={language.t("settings.llm.row.parallelToolCalls.description")}
        >
          <div data-action="settings-llm-parallel-tool-calls">
            <Switch
              checked={config().llm?.parallel_tool_calls ?? true}
              onChange={(checked) => {
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), parallel_tool_calls: checked },
                })
              }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.llm")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <ToolFormatSection />
        <BurstSection />
        <ToolOutputSection />
        <WorkflowSection />
        <CompactionSection />
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string
  description: string
  children: JSX.Element
}

import type { JSX } from "solid-js"

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
