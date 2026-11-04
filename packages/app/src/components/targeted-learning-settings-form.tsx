// packages/app/src/components/targeted-learning-settings-form.tsx
//
// Schema-driven settings for every Targeted Learning section (plan §11.1): the form is generated
// from GET /targeted-learning/settings/schema, so a new setting needs no UI work. Shared by the v1
// and v2 settings layouts. Edits are saved per field (PATCH, merged per section on the server).

import { Component, For, Show, createResource, createSignal } from "solid-js"
import { Button } from "@diveeoi/ui/button"
import { Icon, type IconProps } from "@diveeoi/ui/icon"
import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { useServerSDK } from "@/context/server-sdk"
import { authFetch } from "@/utils/auth-client"
import "./targeted-learning.css"

type Json = Record<string, any>

const GROUP_TITLES: Record<string, string> = {
  download: "Download",
  embedding: "Embedding model",
  chunking: "Chunking",
  indexing: "Indexing and resources",
  ocr: "OCR (scanned books)",
  retrieval: "Retrieval",
  gate: "Retrieval gate",
  grounding: "Grounding",
  memory: "Student memory",
  language: "Language (Arabic and English)",
  summaries: "Book summaries",
}

const APPLIES: Record<string, string> = {
  live: "applies immediately",
  "recycle-workers": "applies to the next indexing run",
  reindex: "re-index books to apply",
  "rebuild-fts": "rebuilds the search index",
  restart: "restart DiveeOI to apply",
}

const GROUP_ICONS: Record<string, IconProps["name"]> = {
  download: "download",
  embedding: "brain",
  chunking: "checklist",
  indexing: "folder",
  ocr: "photo",
  retrieval: "magnifying-glass",
  gate: "shield",
  grounding: "check",
  memory: "brain",
  language: "bullet-list",
  summaries: "book",
}

export const TargetedLearningSettingsForm: Component<{ ready: boolean; v2?: boolean }> = (props) => {
  const serverSDK = useServerSDK()
  const base = () => `${serverSDK().url}/targeted-learning`
  const headers = { "content-type": "application/json" }
  const [schema] = createResource(async (): Promise<Json | null> => {
    try {
      const r = await authFetch(`${base()}/settings/schema`, { headers })
      return r.ok ? await r.json() : null
    } catch {
      return null
    }
  })
  const [values, setValues] = createSignal<Json>({})
  const [loaded] = createResource(async () => {
    try {
      const r = await authFetch(`${base()}/settings`, { headers })
      if (r.ok) setValues((await r.json()).values ?? {})
    } catch {
      // leave empty
    }
    return true
  })
  const [status, setStatus] = createSignal("")
  const [applyingPreset, setApplyingPreset] = createSignal<"low" | "balanced" | "high" | null>(null)

  const save = async (group: string | null, key: string, value: unknown, prop: Json) => {
    if (prop["x-danger"] && !window.confirm(`"${prop["x-label"] ?? key}" is a risky setting. Change it anyway?`)) return
    const current = values()
    const body = group ? { [group]: { ...(current[group] ?? {}), [key]: value } } : { [key]: value }
    try {
      const r = await authFetch(`${base()}/settings`, { method: "PATCH", headers, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`rejected (${r.status})`)
      setValues((await r.json()).values ?? current)
      setStatus(`Saved ${prop["x-label"] ?? key} — ${APPLIES[prop["x-applies"] ?? "live"] ?? ""}`)
    } catch (err) {
      setStatus(`Not saved: ${err instanceof Error ? err.message : "error"}`)
    }
  }

  const applyPreset = async (name: "low" | "balanced" | "high") => {
    if (applyingPreset()) return
    setApplyingPreset(name)
    try {
      const presets = await (await authFetch(`${base()}/settings/presets`, { headers })).json()
      const preset = presets[name] ?? {}
      const merged: Json = {}
      for (const [group, section] of Object.entries<Json>(preset))
        merged[group] = { ...(values()[group] ?? {}), ...section }
      const r = await authFetch(`${base()}/settings`, { method: "PATCH", headers, body: JSON.stringify(merged) })
      if (!r.ok) throw new Error(`rejected (${r.status})`)
      setValues((await r.json()).values ?? values())
      setStatus(`Applied the ${name} preset.`)
    } catch (err) {
      setStatus(`Preset not applied: ${err instanceof Error ? err.message : "error"}`)
    } finally {
      setApplyingPreset(null)
    }
  }

  const Field: Component<{ group: string | null; name: string; prop: Json }> = (p) => {
    const current = () => (p.group ? values()[p.group]?.[p.name] : values()[p.name])
    const disabled = () => !props.ready
    const label = () => p.prop["x-label"] ?? p.name
    const [draft, setDraft] = createSignal<string | undefined>(undefined)
    return (
      <div class="flex items-start justify-between gap-4 py-2">
        <div class="flex flex-col gap-0.5 min-w-0">
          <span class="text-14-medium text-text-strong">
            {label()}
            <Show when={p.prop["x-danger"]}>
              <span class="ml-1 text-[var(--warning-fg)]">⚠</span>
            </Show>
          </span>
          <span class="text-12-regular text-text-weak">
            {p.prop["x-help"] ?? p.prop.description}
            {p.prop["x-unit"] ? ` (${p.prop["x-unit"]})` : ""} · {APPLIES[p.prop["x-applies"] ?? "live"] ?? ""}
          </span>
        </div>
        <div class="shrink-0">
          <Show when={p.prop.type === "boolean"}>
            <input
              type="checkbox"
              disabled={disabled()}
              checked={!!current()}
              onChange={(e) => void save(p.group, p.name, e.currentTarget.checked, p.prop)}
            />
          </Show>
          <Show when={Array.isArray(p.prop.enum)}>
            <select
              class="text-12-regular bg-transparent border border-border-weak-base rounded px-2 py-1"
              disabled={disabled()}
              value={String(current() ?? "")}
              onChange={(e) => void save(p.group, p.name, e.currentTarget.value, p.prop)}
            >
              <For each={p.prop.enum as string[]}>{(opt) => <option value={opt}>{opt}</option>}</For>
            </select>
          </Show>
          <Show when={p.prop.type === "number" && !Array.isArray(p.prop.enum)}>
            <input
              type="number"
              class="w-24 text-12-regular bg-transparent border border-border-weak-base rounded px-2 py-1"
              disabled={disabled()}
              min={p.prop["x-min"]}
              max={p.prop["x-max"]}
              step="any"
              value={String(current() ?? "")}
              onChange={(e) => {
                const n = Number(e.currentTarget.value)
                const lo = p.prop["x-min"]
                const hi = p.prop["x-max"]
                if (!Number.isFinite(n) || (lo !== undefined && n < lo) || (hi !== undefined && n > hi)) {
                  setStatus(`${label()} must be between ${lo ?? "−∞"} and ${hi ?? "∞"}.`)
                  e.currentTarget.value = String(current() ?? "")
                  return
                }
                void save(p.group, p.name, n, p.prop)
              }}
            />
          </Show>
          <Show when={p.prop.type === "string" && !Array.isArray(p.prop.enum)}>
            <input
              type="text"
              class="w-48 text-12-regular bg-transparent border border-border-weak-base rounded px-2 py-1"
              disabled={disabled()}
              value={String(current() ?? "")}
              onChange={(e) => void save(p.group, p.name, e.currentTarget.value, p.prop)}
            />
          </Show>
          <Show when={p.prop.type === "object"}>
            <textarea
              class="w-64 h-16 text-12-regular font-mono bg-transparent border border-border-weak-base rounded px-2 py-1"
              disabled={disabled()}
              value={draft() ?? JSON.stringify(current() ?? {}, null, 1)}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onBlur={() => {
                const d = draft()
                if (d === undefined) return
                try {
                  void save(p.group, p.name, JSON.parse(d), p.prop)
                  setDraft(undefined)
                } catch {
                  setStatus(`${label()} must be valid JSON.`)
                }
              }}
            />
          </Show>
        </div>
      </div>
    )
  }

  const Section: Component<{ group: string; def: Json }> = (p) => {
    const entries = () => Object.entries<Json>(p.def.properties ?? {})
    const basic = () => entries().filter(([, f]) => !f["x-advanced"])
    const advanced = () => entries().filter(([, f]) => f["x-advanced"])
    return (
      <details class="tl-settings-disclosure-details">
        <summary class="tl-settings-disclosure">
          <span class="tl-settings-disclosure-icon">
            <Icon name={GROUP_ICONS[p.group] ?? "bullet-list"} size="small" />
          </span>
          <span>{GROUP_TITLES[p.group] ?? p.group}</span>
          <Icon name="chevron-right" size="small" class="tl-settings-disclosure-chevron" />
        </summary>
        <div class="tl-settings-disclosure-content">
          <For each={basic()}>{([name, prop]) => <Field group={p.group} name={name} prop={prop} />}</For>
          <Show when={advanced().length > 0}>
            <details class="tl-settings-advanced">
              <summary class="tl-settings-disclosure">
                <span class="tl-settings-disclosure-icon">
                  <Icon name="sliders" size="small" />
                </span>
                <span>Advanced</span>
                <Icon name="chevron-right" size="small" class="tl-settings-disclosure-chevron" />
              </summary>
              <div class="tl-settings-advanced-content">
                <For each={advanced()}>{([name, prop]) => <Field group={p.group} name={name} prop={prop} />}</For>
              </div>
            </details>
          </Show>
        </div>
      </details>
    )
  }

  const groups = () =>
    Object.entries<Json>(schema()?.properties ?? {}).filter(([, def]) => def.type === "object" && def.properties)
  const topLevel = () =>
    Object.entries<Json>(schema()?.properties ?? {}).filter(([, def]) => def.type !== "object" && def["x-label"])

  return (
    <div class="flex flex-col gap-3 py-4 border-b border-border-weak-base">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-14-medium text-text-strong">Settings</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-12-regular text-text-weak">Preset</span>
          <For each={["low", "balanced", "high"] as const}>
            {(name) =>
              props.v2 ? (
                <ButtonV2
                  size="small"
                  variant="neutral"
                  class="tl-settings-preset-button"
                  disabled={!props.ready || !!applyingPreset()}
                  onClick={() => void applyPreset(name)}
                >
                  {applyingPreset() === name ? "Applying…" : name[0].toUpperCase() + name.slice(1)}
                </ButtonV2>
              ) : (
                <Button
                  size="small"
                  variant="secondary"
                  class="tl-settings-preset-button"
                  disabled={!props.ready || !!applyingPreset()}
                  onClick={() => void applyPreset(name)}
                >
                  {applyingPreset() === name ? "Applying…" : name[0].toUpperCase() + name.slice(1)}
                </Button>
              )
            }
          </For>
        </div>
      </div>
      <Show when={!props.ready}>
        <div class="text-12-regular text-text-weak">Run Setup first to enable these settings.</div>
      </Show>
      <Show when={status()}>
        <div class="text-12-regular text-text-weak">{status()}</div>
      </Show>
      <Show when={loaded() && schema()} fallback={<div class="text-12-regular text-text-weak">Loading settings…</div>}>
        <div class="flex flex-col">
          <Show when={topLevel().length > 0}>
            <details class="tl-settings-disclosure-details">
              <summary class="tl-settings-disclosure">
                <span class="tl-settings-disclosure-icon">
                  <Icon name="settings-gear" size="small" />
                </span>
                <span>General</span>
                <Icon name="chevron-right" size="small" class="tl-settings-disclosure-chevron" />
              </summary>
              <div class="tl-settings-disclosure-content">
                <For each={topLevel()}>{([name, prop]) => <Field group={null} name={name} prop={prop} />}</For>
              </div>
            </details>
          </Show>
          <For each={groups()}>{([group, def]) => <Section group={group} def={def} />}</For>
        </div>
      </Show>
    </div>
  )
}
