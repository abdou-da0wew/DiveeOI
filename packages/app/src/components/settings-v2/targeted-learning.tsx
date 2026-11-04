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
import { formatSetupStepLabel, TargetedLearningStatusBadge } from "../targeted-learning-status"
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
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">Targeted Learning</h2>
        <p class="text-12-regular text-text-weak leading-5">
          Self-hosted, book-grounded learning sessions. Add your books and build a tutor that can retrieve relevant
          passages with citations.
        </p>
      </div>
      <div class="settings-v2-tab-body settings-v2-learning">
        <section class="settings-v2-section">
          <h3 class="settings-v2-section-title">Learning workspace</h3>
          <Suspense fallback={<div class="settings-v2-panel-skeleton">Loading…</div>}>
            <SettingsListV2>
              {/* ---------- Backend unreachable notice ---------- */}
              <Show when={status()?.status === "unreachable"}>
                <SettingsRowV2
                  title="Backend unreachable"
                  description="The DiveeOI server could not be reached, so the Targeted Learning state is unknown. Check that the server is running and reload."
                >
                  <TargetedLearningStatusBadge status="failed" label="Offline" />
                </SettingsRowV2>
              </Show>

              {/* ---------- Setup ---------- */}
              <SettingsRowV2
                title="Setup"
                description="Self-hosted, book-grounded learning sessions. Downloads the bge-m3 embedding model (~568 MB) on first run."
              >
                <Show
                  when={isReady()}
                  fallback={
                    <div class="flex flex-wrap items-center justify-end gap-2">
                      <TargetedLearningStatusBadge
                        status={setupBadgeStatus(status()?.status)}
                        label={setupBadgeLabel(status()?.status)}
                      />
                      <ButtonV2 onClick={start} disabled={starting()}>
                        {starting() ? "Starting…" : "Start Setup"}
                      </ButtonV2>
                    </div>
                  }
                >
                  <TargetedLearningStatusBadge status="complete" label="Ready" />
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

              {/* Setup steps */}
              <Show when={status()?.steps.length}>
                <div class="settings-v2-subsection">
                  <div class="settings-v2-subsection-title">Setup steps</div>
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

              {/* Health snapshot */}
              <Show when={health()}>
                {(h) => (
                  <div class="settings-v2-subsection">
                    <div class="settings-v2-subsection-title">Health</div>
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
              <TargetedLearningSettingsForm ready={isReady()} v2 />
            </SettingsListV2>
          </Suspense>
        </section>
      </div>
    </>
  )
}
