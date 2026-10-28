// packages/app/src/components/targeted-learning-settings-form.tsx
//
// Schema-driven settings for every Targeted Learning section (plan §11.1): the form is generated
// from GET /targeted-learning/settings/schema, so a new setting needs no UI work. Shared by the v1
// and v2 settings layouts. Edits are saved per field (PATCH, merged per section on the server).

import { Component, For, Show, createResource, createSignal } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"

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

export const TargetedLearningSettingsForm: Component<{ ready: boolean }> = (props) => {
  const serverSDK = useServerSDK()
  const base = () => `${serverSDK().url}/targeted-learning`
  const headers = { "content-type": "application/json" }
  const [schema] = createResource(async (): Promise<Json | null> => {
    try {
      const r = await fetch(`${base()}/settings/schema`, { headers })
      return r.ok ? await r.json() : null
    } catch {
      return null
    }
  })
  const [values, setValues] = createSignal<Json>({})
  const [loaded] = createResource(async () => {
    try {
      const r = await fetch(`${base()}/settings`, { headers })
      if (r.ok) setValues((await r.json()).values ?? {})
    } catch {
      // leave empty
    }
    return true
  })
  const [status, setStatus] = createSignal("")

  const save = async (group: string | null, key: string, value: unknown, prop: Json) => {
    if (prop["x-danger"] && !window.confirm(`"${prop["x-label"] ?? key}" is a risky setting. Change it anyway?`)) return
    const current = values()
    const body = group ? { [group]: { ...(current[group] ?? {}), [key]: value } } : { [key]: value }
    try {
      const r = await fetch(`${base()}/settings`, { method: "PATCH", headers, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`rejected (${r.status})`)
      setValues((await r.json()).values ?? current)
      setStatus(`Saved ${prop["x-label"] ?? key} — ${APPLIES[prop["x-applies"] ?? "live"] ?? ""}`)
    } catch (err) {
      setStatus(`Not saved: ${err instanceof Error ? err.message : "error"}`)
    }
  }

  const applyPreset = async (name: "low" | "balanced" | "high") => {
    try {
      const presets = await (await fetch(`${base()}/settings/presets`, { headers })).json()
      const preset = presets[name] ?? {}
      const merged: Json = {}
      for (const [group, section] of Object.entries<Json>(preset)) merged[group] = { ...(values()[group] ?? {}), ...section }
      const r = await fetch(`${base()}/settings`, { method: "PATCH", headers, body: JSON.stringify(merged) })
      if (!r.ok) throw new Error(`rejected (${r.status})`)
      setValues((await r.json()).values ?? values())
      setStatus(`Applied the ${name} preset.`)
    } catch (err) {
      setStatus(`Preset not applied: ${err instanceof Error ? err.message : "error"}`)
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
          <span class="text-12-medium text-text-strong">
            {label()}
            <Show when={p.prop["x-danger"]}>
              <span class="ml-1 text-[var(--warning-fg)]">⚠</span>
            </Show>
          </span>
          <span class="text-11-regular text-text-weak">
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
              class="text-12-regular bg-transparent border border-[var(--surface-stronger-non-alpha)] rounded px-2 py-1"
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
              class="w-24 text-12-regular bg-transparent border border-[var(--surface-stronger-non-alpha)] rounded px-2 py-1"
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
              class="w-48 text-12-regular bg-transparent border border-[var(--surface-stronger-non-alpha)] rounded px-2 py-1"
              disabled={disabled()}
              value={String(current() ?? "")}
              onChange={(e) => void save(p.group, p.name, e.currentTarget.value, p.prop)}
            />
          </Show>
          <Show when={p.prop.type === "object"}>
            <textarea
              class="w-64 h-16 text-11-regular font-mono bg-transparent border border-[var(--surface-stronger-non-alpha)] rounded px-2 py-1"
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
      <details class="border-b border-[var(--surface-stronger-non-alpha)] py-2">
        <summary class="cursor-pointer text-13-medium text-text-strong py-1">{GROUP_TITLES[p.group] ?? p.group}</summary>
        <div class="flex flex-col pl-2">
          <For each={basic()}>{([name, prop]) => <Field group={p.group} name={name} prop={prop} />}</For>
          <Show when={advanced().length > 0}>
            <details class="mt-1">
              <summary class="cursor-pointer text-11-regular text-text-weak py-1">Advanced</summary>
              <For each={advanced()}>{([name, prop]) => <Field group={p.group} name={name} prop={prop} />}</For>
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
    <div class="flex flex-col gap-1 py-3 border-b border-[var(--surface-stronger-non-alpha)]">
      <div class="flex items-center justify-between gap-4">
        <span class="text-13-medium text-text-strong">Settings</span>
        <div class="flex items-center gap-2">
          <span class="text-11-regular text-text-weak">Preset</span>
          <For each={["low", "balanced", "high"] as const}>
            {(name) => (
              <button
                class="text-11-regular px-2 py-1 rounded border border-[var(--surface-stronger-non-alpha)]"
                classList={{ "opacity-50 pointer-events-none": !props.ready }}
                disabled={!props.ready}
                onClick={() => void applyPreset(name)}
              >
                {name}
              </button>
            )}
          </For>
        </div>
      </div>
      <Show when={!props.ready}>
        <div class="text-11-regular text-text-weak">Run Setup first to enable these settings.</div>
      </Show>
      <Show when={status()}>
        <div class="text-11-regular text-text-weak">{status()}</div>
      </Show>
      <Show when={loaded() && schema()} fallback={<div class="text-11-regular text-text-weak">Loading settings…</div>}>
        <div class="flex flex-col">
          <Show when={topLevel().length > 0}>
            <details class="border-b border-[var(--surface-stronger-non-alpha)] py-2">
              <summary class="cursor-pointer text-13-medium text-text-strong py-1">General</summary>
              <div class="flex flex-col pl-2">
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
