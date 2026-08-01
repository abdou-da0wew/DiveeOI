import { Component, createMemo } from "solid-js"
import { SelectV2 } from "@diveeoi/ui/v2/select-v2"
import { Switch } from "@diveeoi/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

export const SettingsLlmV2: Component = () => {
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
    <div class="settings-v2-section">
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.llm.row.format.title")}
          description={language.t("settings.llm.row.format.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-llm-format"
            options={formatOptions()}
            current={formatOptions().find((o) => o.value === currentFormat())}
            placement="bottom-end"
            gutter={6}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              if (option.value === currentFormat()) return
              serverSync().updateConfig({ llm: { ...(config().llm ?? {}), format: option.value } })
            }}
          />
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const BurstSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.llm.section.burst")}</h3>

      <SettingsListV2>
        <SettingsRowV2
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
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.llm.row.burstStrategy.title")}
          description={language.t("settings.llm.row.burstStrategy.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-llm-burst-strategy"
            options={burstStrategyOptions()}
            current={burstStrategyOptions().find((o) => o.value === (config().llm?.burst?.strategy ?? "truncate"))}
            placement="bottom-end"
            gutter={6}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              const current = config().llm?.burst ?? {}
              serverSync().updateConfig({
                llm: { ...(config().llm ?? {}), burst: { ...current, strategy: option.value as "truncate" | "buffer" | "abort" } },
              })
            }}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.llm.row.burstAction.title")}
          description={language.t("settings.llm.row.burstAction.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-llm-burst-action"
            options={burstActionOptions()}
            current={burstActionOptions().find((o) => o.value === (config().llm?.burst?.action ?? "warn"))}
            placement="bottom-end"
            gutter={6}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              const current = config().llm?.burst ?? {}
              serverSync().updateConfig({
                llm: { ...(config().llm ?? {}), burst: { ...current, action: option.value as "warn" | "truncate" | "abort" } },
              })
            }}
          />
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const ToolOutputSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.llm.section.toolOutput")}</h3>

      <SettingsListV2>
        <SettingsRowV2
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
        </SettingsRowV2>

        <SettingsRowV2
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
        </SettingsRowV2>

        <SettingsRowV2
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
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const CompactionSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.llm.section.compaction")}</h3>

      <SettingsListV2>
        <SettingsRowV2
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
        </SettingsRowV2>

        <SettingsRowV2
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
        </SettingsRowV2>

        <SettingsRowV2
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
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const WorkflowSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.llm.section.workflow")}</h3>

      <SettingsListV2>
        <SettingsRowV2
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
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.llm")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <ToolFormatSection />
        <BurstSection />
        <ToolOutputSection />
        <WorkflowSection />
        <CompactionSection />
      </div>
    </>
  )
}
