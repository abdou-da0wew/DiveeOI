// packages/app/src/components/settings-targeted-learning.tsx
//
// v1 layout — Targeted Learning settings tab.
// Same content as settings-v2/targeted-learning.tsx, wrapped in the v1
// SettingsList chrome. Per plan §11.6, the settings form is a
// layout-agnostic, schema-driven set of components; each layout's settings
// shell only mounts the tab and supplies its own navigation chrome.
//
// For Phase 1 we duplicate the component rather than share, because the
// v1 and v2 styling primitives differ (Switch vs SwitchV2, etc.). Phase 5
// collapses these into one schema-driven form.

import { Component, For, Show, createResource, createSignal, Suspense } from "solid-js"
import { Button } from "@diveeoi/ui/button"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsList } from "./settings-list"
import { TargetedLearningLibrary } from "./targeted-learning-library"
import { TargetedLearningMemory } from "./targeted-learning-memory"
import { TargetedLearningSettingsForm } from "./targeted-learning-settings-form"

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


const useTlApi = () => {
  const serverSDK = useServerSDK()
  const base = () => serverSDK().url
  const headers = () => ({ "content-type": "application/json" }) as Record<string, string>
  return {
    getStatus: async (): Promise<SetupStatus> => {
      try {
        const resp = await fetch(`${base()}/targeted-learning/setup`, { headers: headers() })
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
      const resp = await fetch(`${base()}/targeted-learning/setup/start`, {
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
      const resp = await fetch(`${base()}/targeted-learning/setup/repair`, {
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
        const resp = await fetch(`${base()}/targeted-learning/health`, { headers: headers() })
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

export const SettingsTargetedLearning: Component = () => {
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
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col flex-1 min-h-0 max-w-[720px]">
        <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
          <div class="flex flex-col gap-1 pt-6 pb-8">
            <h2 class="text-16-medium text-text-strong">Targeted Learning</h2>
            <p class="text-12-regular text-text-weak">
              Self-hosted, book-grounded learning sessions. Downloads the bge-m3 embedding model (~568 MB) on first run.
            </p>
          </div>
        </div>

        <Suspense fallback={<div class="text-12-regular text-text-weak">Loading…</div>}>
          <SettingsList>
            {/* Backend unreachable notice */}
            <Show when={status()?.status === "unreachable"}>
              <div class="flex items-center justify-between gap-4 py-3 border-b border-[var(--surface-stronger-non-alpha)]">
                <div class="flex flex-col gap-1">
                  <span class="text-13-medium text-text-strong">Backend unreachable</span>
                  <span class="text-11-regular text-text-weak">
                    The DiveeOI server could not be reached, so the Targeted Learning state is unknown.
                  </span>
                </div>
                <span class="text-11-medium text-[var(--warning-fg)]">Offline</span>
              </div>
            </Show>

            {/* Setup */}
            <div class="flex items-center justify-between gap-4 py-3 border-b border-[var(--surface-stronger-non-alpha)]">
              <div class="flex flex-col gap-1">
                <span class="text-13-medium text-text-strong">Setup</span>
                <span class="text-11-regular text-text-weak">Run once to download the model and verify it works.</span>
              </div>
              <Show
                when={isReady()}
                fallback={
                  <Button size="small" onClick={start} disabled={starting()}>
                    {starting() ? "Starting…" : "Start Setup"}
                  </Button>
                }
              >
                <span class="text-11-medium text-[var(--success-fg)]">Ready</span>
              </Show>
            </div>

            <Show when={needsRepair()}>
              <div class="flex items-center justify-between gap-4 py-3 border-b border-[var(--surface-stronger-non-alpha)]">
                <div class="flex flex-col gap-1">
                  <span class="text-13-medium text-text-strong">Repair</span>
                  <span class="text-11-regular text-text-weak">Setup state is marked needs-repair.</span>
                </div>
                <Button size="small" variant="ghost" onClick={repair} disabled={starting()}>
                  Repair
                </Button>
              </div>
            </Show>

            {/* Setup steps */}
            <Show when={status()?.steps.length}>
              <div class="py-3 border-b border-[var(--surface-stronger-non-alpha)]">
                <div class="text-11-medium text-text-weak mb-2">Setup steps</div>
                <div class="flex flex-col gap-1">
                  <For each={status()!.steps}>
                    {(step) => (
                      <div class="flex items-center gap-2 text-11-regular">
                        <span class="text-text-strong">{step.name}</span>
                        <span class={`text-text-weak step-status-${step.status}`}>{step.status}</span>
                        <Show when={step.attempts > 1}>
                          <span class="text-text-weak">×{step.attempts}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Health */}
            <Show when={health()}>
              {(h) => (
                <div class="py-3 border-b border-[var(--surface-stronger-non-alpha)]">
                  <div class="text-11-medium text-text-weak mb-2">Health</div>
                  <div class="grid grid-cols-3 gap-2 text-11-regular">
                    <div>
                      <div class="text-text-weak">books.db</div>
                      <div class={h().booksDbAvailable ? "text-[var(--success-fg)]" : "text-[var(--warning-fg)]"}>
                        {h().booksDbAvailable ? "available" : "unavailable"}
                      </div>
                    </div>
                    <div>
                      <div class="text-text-weak">manifest</div>
                      <div class={h().manifestLoaded ? "text-[var(--success-fg)]" : "text-[var(--warning-fg)]"}>
                        {h().manifestLoaded ? "loaded" : "missing"}
                      </div>
                    </div>
                    <div>
                      <div class="text-text-weak">model</div>
                      <div class={h().modelReady ? "text-[var(--success-fg)]" : "text-[var(--warning-fg)]"}>
                        {h().modelReady ? "ready" : "not ready"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Show>

            <TargetedLearningLibrary ready={isReady()} />

            <TargetedLearningMemory ready={isReady()} />
            <TargetedLearningSettingsForm ready={isReady()} />
          </SettingsList>
        </Suspense>
      </div>
      <div class="text-11-regular text-text-weak pt-4">{language.t("app.name.desktop")}</div>
    </div>
  )
}
