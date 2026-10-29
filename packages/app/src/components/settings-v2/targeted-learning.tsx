// packages/app/src/components/settings-v2/targeted-learning.tsx
//
// Targeted Learning settings tab (Phase 5 UI, §11.5).
//
// Phase 1 ships a Setup-only shell. Per plan §11.5: "Before Setup is Ready,
// only Start Setup is enabled. Everything else is visible but disabled,
// each with a one-line reason."
//
// All other sections (Library, Student memory, Embedding, Chunking and
// indexing, Retrieval, Grounding, Resources, Language, Advanced and
// danger) render in a disabled state with their one-line reason. Phase 5
// fills them in with real schema-driven form fields once the
// `@diveeoi/learning/settings` schema's annotations are wired into a
// generic form-generator component.

import { TargetedLearningLibrary } from "../targeted-learning-library"
import { TargetedLearningMemory } from "../targeted-learning-memory"
import { TargetedLearningSettingsForm } from "../targeted-learning-settings-form"
import { Component, For, Show, createResource, createSignal, Suspense } from "solid-js"
import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"
import { authFetch } from "@/utils/auth-client"

interface SetupStep {
  name: string
  status: "pending" | "running" | "complete" | "failed" | "skipped"
  attempts: number
  lastError?: string
}

interface SetupStatus {
  status: "not-started" | "in-progress" | "ready" | "needs-repair" | "unreachable"
  steps: SetupStep[]
  recommendedProfile?: "low" | "balanced" | "high"
}

interface Health {
  setupStatus: string
  booksDbAvailable: boolean
  booksDbReason?: string
  modelReady: boolean
  manifestLoaded: boolean
}


// Direct fetch helper — the typed SDK hasn't been regenerated yet for the
// /targeted-learning/* routes. We use the same auth headers the SDK uses.
const useTlApi = () => {
  const serverSDK = useServerSDK()
  const base = () => serverSDK().url
  const headers = () => {
    const h: Record<string, string> = { "content-type": "application/json" }
    // The SDK injects Authorization via fetch interceptor; for raw fetch
    // we re-derive from the same context.
    return h
  }
  return {
    getStatus: async (): Promise<SetupStatus> => {
      try {
        const resp = await authFetch(`${base()}/targeted-learning/setup`, { headers: headers() })
        if (!resp.ok) throw new Error(`setup status: ${resp.status}`)
        return await resp.json()
      } catch {
        // Backend unreachable (e.g. wrong host/port): degrade to a visible
        // state instead of crashing the whole app via resource rethrow.
        return { status: "unreachable", steps: [] }
      }
    },
    start: async (force = false): Promise<SetupStatus> => {
  try {
      const resp = await authFetch(`${base()}/targeted-learning/setup/start`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ force }),
      })
      if (!resp.ok) throw new Error(`setup start: ${resp.status}`)
      return resp.json()
  } catch {
    return { status: "unreachable", steps: [] }
  }
    },
    repair: async (): Promise<SetupStatus> => {
  try {
      const resp = await authFetch(`${base()}/targeted-learning/setup/repair`, {
        method: "POST",
        headers: headers(),
      })
      if (!resp.ok) throw new Error(`setup repair: ${resp.status}`)
      return resp.json()
  } catch {
    return { status: "unreachable", steps: [] }
  }
    },
    getHealth: async (): Promise<Health> => {
      try {
        const resp = await authFetch(`${base()}/targeted-learning/health`, { headers: headers() })
        if (!resp.ok) throw new Error(`health: ${resp.status}`)
        return await resp.json()
      } catch {
        return {
          setupStatus: "unreachable",
          booksDbAvailable: false,
          modelReady: false,
          manifestLoaded: false,
        }
      }
    },
  }
}

export const SettingsTargetedLearningV2: Component = () => {
  const language = useLanguage()
  const api = useTlApi()
  const [status, { refetch }] = createResource<SetupStatus>(api.getStatus)
  const [health] = createResource<Health>(api.getHealth)
  const [starting, setStarting] = createSignal(false)

  const start = async () => {
    setStarting(true)
    try {
      await api.start(false)
      await refetch()
    } finally {
      setStarting(false)
    }
  }

  const repair = async () => {
    setStarting(true)
    try {
      await api.repair()
      await refetch()
    } finally {
      setStarting(false)
    }
  }

  const isReady = () => status()?.status === "ready"
  const needsRepair = () => status()?.status === "needs-repair"

  return (
    <Suspense fallback={<div class="settings-v2-panel-skeleton">Loading…</div>}>
      <SettingsListV2>
        {/* ---------- Backend unreachable notice ---------- */}
        <Show when={status()?.status === "unreachable"}>
          <SettingsRowV2
            title="Backend unreachable"
            description="The DiveeOI server could not be reached, so the Targeted Learning state is unknown. Check that the server is running and reload."
          >
            <span class="settings-v2-tag settings-v2-tag-warning">Offline</span>
          </SettingsRowV2>
        </Show>

        {/* ---------- Setup ---------- */}
        <SettingsRowV2
          title="Targeted Learning"
          description="Self-hosted, book-grounded learning sessions. Downloads the bge-m3 embedding model (~568 MB) on first run."
        >
          <Show
            when={isReady()}
            fallback={
              <ButtonV2 onClick={start} disabled={starting()}>
                {starting() ? "Starting…" : "Start Setup"}
              </ButtonV2>
            }
          >
            <span class="settings-v2-tag settings-v2-tag-success">Ready</span>
          </Show>
        </SettingsRowV2>

        <Show when={needsRepair()}>
          <SettingsRowV2
            title="Repair"
            description="Setup state is marked needs-repair. Click to clear all step statuses and re-run from probe."
          >
            <ButtonV2 variant="ghost" onClick={repair} disabled={starting()}>
              Repair
            </ButtonV2>
          </SettingsRowV2>
        </Show>

        {/* Setup steps table */}
        <Show when={status()?.steps.length}>
          <div class="settings-v2-subsection">
            <div class="settings-v2-subsection-title">Setup steps</div>
            <div class="settings-v2-steps-table">
              <For each={status()!.steps}>
                {(step) => (
                  <div class="settings-v2-step-row">
                    <span class="settings-v2-step-name">{step.name}</span>
                    <span class={`settings-v2-step-status settings-v2-step-status-${step.status}`}>
                      {step.status}
                    </span>
                    <Show when={step.attempts > 1}>
                      <span class="settings-v2-step-attempts">×{step.attempts}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Health snapshot */}
        <Show when={health()}>
          {(h) => (
            <div class="settings-v2-subsection">
              <div class="settings-v2-subsection-title">Health</div>
              <div class="settings-v2-health-grid">
                <div>
                  <span>books.db</span>
                  <span class={h().booksDbAvailable ? "ok" : "warn"}>
                    {h().booksDbAvailable ? "available" : h().booksDbReason ?? "unavailable"}
                  </span>
                </div>
                <div>
                  <span>manifest</span>
                  <span class={h().manifestLoaded ? "ok" : "warn"}>
                    {h().manifestLoaded ? "loaded" : "missing"}
                  </span>
                </div>
                <div>
                  <span>model</span>
                  <span class={h().modelReady ? "ok" : "warn"}>
                    {h().modelReady ? "ready" : "not ready"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </Show>

        <TargetedLearningLibrary ready={isReady()} />

        <TargetedLearningMemory ready={isReady()} />
        <TargetedLearningSettingsForm ready={isReady()} />
      </SettingsListV2>
    </Suspense>
  )
}
