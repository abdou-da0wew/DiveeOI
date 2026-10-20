import { Component, createEffect, createMemo, createSignal } from "solid-js"
import { SelectV2 } from "@diveeoi/ui/v2/select-v2"
import { Switch } from "@diveeoi/ui/v2/switch-v2"
import { TextInputV2 } from "@diveeoi/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

export const SettingsLlmV2: Component = () => {
  const language = useLanguage()
  const serverSync = useServerSync()

  const config = createMemo(() => serverSync().data.config)

  /**
   * A numeric setting. The previous controls were switches that flipped a
   * hard-coded value on and off, so "500 lines" was the only thing you could
   * ever pick. This commits the number you type.
   */
  const NumberField = (props: {
    value: number | string | undefined
    fallback?: number
    min?: number
    max?: number
    "data-action"?: string
    label: string
    onCommit: (value: number | undefined) => void
  }) => {
    // The config schema allows the string forms of NaN/Infinity; treat them as unset.
    const current = () => {
      const value = props.value
      return typeof value === "number" && Number.isFinite(value) ? value : undefined
    }
    const [text, setText] = createSignal(current() === undefined ? "" : String(current()))
    createEffect(() => {
      const value = current()
      setText(value === undefined ? "" : String(value))
    })
    const commit = () => {
      const raw = text().trim()
      if (!raw) {
        props.onCommit(undefined)
        return
      }
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) {
        setText(current() === undefined ? "" : String(current()))
        return
      }
      const clamped = Math.min(props.max ?? Number.MAX_SAFE_INTEGER, Math.max(props.min ?? 0, Math.round(parsed)))
      setText(String(clamped))
      if (clamped === current()) return
      props.onCommit(clamped)
    }
    return (
      <TextInputV2
        data-action={props["data-action"]}
        type="number"
        appearance="base"
        min={props.min ?? 0}
        max={props.max}
        step={1}
        value={text()}
        placeholder={props.fallback === undefined ? "" : String(props.fallback)}
        aria-label={props.label}
        onInput={(event) => setText(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          event.preventDefault()
          event.currentTarget.blur()
        }}
      />
    )
  }

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
            <NumberField
              data-action="settings-llm-burst-bytes-per-second-input"
              label={language.t("settings.llm.row.burstMaxBytesPerSecond.title")}
              value={config().llm?.burst?.max_bytes_per_second}
              fallback={51200}
              min={0}
              onCommit={(value) => {
                const current = config().llm?.burst ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), burst: { ...current, max_bytes_per_second: value } },
                })
              }}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.llm.row.burstMaxBurstBytes.title")}
          description={language.t("settings.llm.row.burstMaxBurstBytes.description")}
        >
          <div data-action="settings-llm-burst-max-burst-bytes">
            <NumberField
              data-action="settings-llm-burst-max-burst-bytes-input"
              label={language.t("settings.llm.row.burstMaxBurstBytes.title")}
              value={config().llm?.burst?.max_burst_bytes}
              fallback={262144}
              min={0}
              onCommit={(value) => {
                const current = config().llm?.burst ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), burst: { ...current, max_burst_bytes: value } },
                })
              }}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.llm.row.burstWindowMs.title")}
          description={language.t("settings.llm.row.burstWindowMs.description")}
        >
          <div data-action="settings-llm-burst-window">
            <NumberField
              data-action="settings-llm-burst-window-input"
              label={language.t("settings.llm.row.burstWindowMs.title")}
              value={config().llm?.burst?.window_ms}
              fallback={1000}
              min={0}
              onCommit={(value) => {
                const current = config().llm?.burst ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), burst: { ...current, window_ms: value } },
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
            <NumberField
              data-action="settings-llm-max-tool-output-lines-input"
              label={language.t("settings.llm.row.maxToolOutputLines.title")}
              value={config().llm?.tool_output?.max_lines}
              fallback={500}
              min={1}
              onCommit={(value) => {
                const current = config().llm?.tool_output ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), tool_output: { ...current, max_lines: value } },
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
            <NumberField
              data-action="settings-llm-max-tool-output-bytes-input"
              label={language.t("settings.llm.row.maxToolOutputBytes.title")}
              value={config().llm?.tool_output?.max_bytes}
              fallback={25600}
              min={1}
              onCommit={(value) => {
                const current = config().llm?.tool_output ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), tool_output: { ...current, max_bytes: value } },
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
            <NumberField
              data-action="settings-llm-max-tool-output-input"
              label={language.t("settings.llm.row.maxToolOutput.title")}
              value={config().llm?.max_tool_output}
              fallback={100000}
              min={1}
              onCommit={(value) => {
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), max_tool_output: value },
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
            <NumberField
              data-action="settings-llm-compact-tail-turns-input"
              label={language.t("settings.llm.row.compactTailTurns.title")}
              value={config().llm?.compaction?.tail_turns}
              fallback={4}
              min={0}
              onCommit={(value) => {
                const current = config().llm?.compaction ?? {}
                serverSync().updateConfig({
                  llm: { ...(config().llm ?? {}), compaction: { ...current, tail_turns: value } },
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
