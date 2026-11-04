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
import { formatSetupStepLabel, TargetedLearningStatusBadge } from "./targeted-learning-status"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsList } from "./settings-list"
import { TargetedLearningLibrary } from "./targeted-learning-library"
import { TargetedLearningMemory } from "./targeted-learning-memory"
import { TargetedLearningSettingsForm } from "./targeted-learning-settings-form"
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

const healthStatus = (available: boolean, setupStatus: string) => {
  if (available) return "complete" as const
  if (setupStatus === "not-started" || setupStatus === "in-progress") return "pending" as const
  return "failed" as const
}

const healthLabel = (available: boolean, setupStatus: string, ready: string, unavailable: string) => {
  if (available) return ready
  if (setupStatus === "not-started" || setupStatus === "in-progress") return "Pending"
  return unavailable
}

const setupBadgeStatus = (status?: SetupStatus["status"]) => {
  if (status === "ready") return "complete" as const
  if (status === "in-progress") return "running" as const
  if (status === "needs-repair" || status === "unreachable") return "failed" as const
  return "pending" as const
}

const setupBadgeLabel = (status?: SetupStatus["status"]) => {
  if (!status) return "Checking"
  if (status === "ready") return "Ready"
  if (status === "in-progress") return "Running"
  if (status === "needs-repair") return "Needs repair"
  if (status === "unreachable") return "Offline"
  return "Not set up"
}

const useTlApi = () => {
  const serverSDK = useServerSDK()
  const base = () => serverSDK().url
  const headers = () => ({ "content-type": "application/json" }) as Record<string, string>
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

export const SettingsTargetedLearning: Component = () => {
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
              <div class="flex items-center justify-between gap-4 py-4 border-b border-border-weak-base">
                <div class="flex flex-col gap-1">
                  <span class="text-14-medium text-text-strong">Backend unreachable</span>
                  <span class="text-12-regular text-text-weak">
                    The DiveeOI server could not be reached, so the Targeted Learning state is unknown.
                  </span>
                </div>
                <TargetedLearningStatusBadge status="failed" label="Offline" />
              </div>
            </Show>

            {/* Setup */}
            <div class="flex items-center justify-between gap-4 py-4 border-b border-border-weak-base">
              <div class="flex flex-col gap-1">
                <span class="text-14-medium text-text-strong">Setup</span>
                <span class="text-12-regular text-text-weak">Run once to download the model and verify it works.</span>
              </div>
              <Show
                when={isReady()}
                fallback={
                  <div class="flex items-center gap-2">
                    <TargetedLearningStatusBadge
                      status={setupBadgeStatus(status()?.status)}
                      label={setupBadgeLabel(status()?.status)}
                    />
                    <Button size="small" onClick={start} disabled={starting()}>
                      {starting() ? "Starting…" : "Start Setup"}
                    </Button>
                  </div>
                }
              >
                <TargetedLearningStatusBadge status="complete" label="Ready" />
              </Show>
            </div>

            <Show when={needsRepair()}>
              <div class="flex items-center justify-between gap-4 py-4 border-b border-border-weak-base">
                <div class="flex flex-col gap-1">
                  <span class="text-14-medium text-text-strong">Repair</span>
                  <span class="text-12-regular text-text-weak">Setup state is marked needs-repair.</span>
                </div>
                <Button size="small" variant="ghost" onClick={repair} disabled={starting()}>
                  Repair
                </Button>
              </div>
            </Show>

            {/* Setup steps */}
            <Show when={status()?.steps.length}>
              <div class="py-4 border-b border-border-weak-base">
                <div class="text-14-medium text-text-strong mb-3">Setup steps</div>
                <div class="tl-status-list">
                  <For each={status()!.steps}>
                    {(step) => (
                      <>
                        <div class="tl-status-row">
                          <span class="tl-status-row-label">{formatSetupStepLabel(step.name)}</span>
                          <div class="tl-status-row-meta">
                            <TargetedLearningStatusBadge status={step.status} />
                            <Show when={step.attempts > 1}>
                              <span class="text-11-regular text-text-weak">×{step.attempts}</span>
                            </Show>
                          </div>
                        </div>
                        <Show when={step.status === "failed" && step.lastError}>
                          <div class="tl-status-row-detail">{step.lastError}</div>
                        </Show>
                      </>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Health */}
            <Show when={health()}>
              {(h) => (
                <div class="py-4 border-b border-border-weak-base">
                  <div class="text-14-medium text-text-strong mb-3">Health</div>
                  <div class="tl-status-health">
                    <div class="tl-status-health-item">
                      <span class="tl-status-health-label">books.db</span>
                      <TargetedLearningStatusBadge
                        status={healthStatus(h().booksDbAvailable, h().setupStatus)}
                        label={healthLabel(
                          h().booksDbAvailable,
                          h().setupStatus,
                          "Available",
                          h().booksDbReason ?? "Unavailable",
                        )}
                      />
                    </div>
                    <div class="tl-status-health-item">
                      <span class="tl-status-health-label">manifest</span>
                      <TargetedLearningStatusBadge
                        status={healthStatus(h().manifestLoaded, h().setupStatus)}
                        label={healthLabel(h().manifestLoaded, h().setupStatus, "Loaded", "Missing")}
                      />
                    </div>
                    <div class="tl-status-health-item">
                      <span class="tl-status-health-label">model</span>
                      <TargetedLearningStatusBadge
                        status={healthStatus(h().modelReady, h().setupStatus)}
                        label={healthLabel(h().modelReady, h().setupStatus, "Ready", "Not ready")}
                      />
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
    </div>
  )
}
