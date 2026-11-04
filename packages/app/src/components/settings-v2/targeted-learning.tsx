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
import { Component, For, Show, createEffect, createResource, createSignal, onCleanup, Suspense } from "solid-js"
import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { formatSetupStepLabel, TargetedLearningStatusBadge } from "../targeted-learning-status"
import { setupIsRunning, useTlApi, type Health, type SetupStatus } from "../targeted-learning-api"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

const healthStatus = (available: boolean, setupStatus: string) => {
  if (available) return "complete" as const
  if (setupStatus === "not-started" || setupStatus === "in-progress") return "pending" as const
  return "failed" as const
}

const healthLabel = (available: boolean, setupStatus: string, ready: string, unavailable: string, pending = "Pending") => {
  if (available) return ready
  if (setupStatus === "not-started" || setupStatus === "in-progress") return pending
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

export const SettingsTargetedLearningV2: Component = () => {
  const language = useLanguage()
  const t = (key: string) => language.t(key as never)
  const api = useTlApi()
  const [status, { refetch }] = createResource<SetupStatus>(api.getStatus)
  const [health] = createResource<Health>(api.getHealth)
  const [starting, setStarting] = createSignal(false)

  // Setup runs on the server in the background — poll while it is in progress so the
  // badge and the step list advance live instead of freezing at "Running".
  createEffect(() => {
    if (setupIsRunning(status())) {
      const timer = setInterval(() => void refetch(), 2500)
      onCleanup(() => clearInterval(timer))
    }
  })

  const start = async () => {
    setStarting(true)
    try {
      await api.start(false)
      await refetch()
    } finally {
      setStarting(false)
    }
  }

  const cancel = async () => {
    setStarting(true)
    try {
      await api.cancel()
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
  const isRunning = () => setupIsRunning(status())

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{t("targetedLearning.tab.title")}</h2>
        <p class="text-12-regular text-text-weak leading-5">{t("targetedLearning.tab.description")}</p>
      </div>
      <div class="settings-v2-tab-body settings-v2-learning">
        <section class="settings-v2-section">
          <h3 class="settings-v2-section-title">{t("targetedLearning.workspace")}</h3>
          <Suspense fallback={<div class="settings-v2-panel-skeleton">Loading…</div>}>
            <SettingsListV2>
              {/* ---------- Backend unreachable notice ---------- */}
              <Show when={status()?.status === "unreachable"}>
                <SettingsRowV2
                  title={t("targetedLearning.unreachable.title")}
                  description={t("targetedLearning.unreachable.description")}
                >
                  <TargetedLearningStatusBadge status="failed" label={t("targetedLearning.status.offline")} />
                </SettingsRowV2>
              </Show>

              {/* ---------- Setup ---------- */}
              <SettingsRowV2
                title={t("targetedLearning.setup.title")}
                description={t("targetedLearning.setup.description")}
              >
                <Show
                  when={isReady()}
                  fallback={
                    <div class="flex flex-wrap items-center justify-end gap-2">
                      <TargetedLearningStatusBadge
                        status={setupBadgeStatus(status()?.status)}
                        label={setupBadgeLabel(status()?.status)}
                      />
                      <Show
                        when={isRunning()}
                        fallback={
                          <ButtonV2 onClick={start} disabled={starting()}>
                            {starting() ? t("targetedLearning.setup.starting") : t("targetedLearning.setup.start")}
                          </ButtonV2>
                        }
                      >
                        <ButtonV2 variant="ghost" onClick={cancel} disabled={starting()}>
                          {t("targetedLearning.setup.cancel")}
                        </ButtonV2>
                      </Show>
                    </div>
                  }
                >
                  <TargetedLearningStatusBadge status="complete" label={t("targetedLearning.status.ready")} />
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
                  <div class="settings-v2-subsection-title">{t("targetedLearning.setupSteps")}</div>
                  <div class="tl-status-list">
                    <For each={status()!.steps}>
                      {(step) => (
                        <>
                          <div class="tl-status-row">
                            <span class="tl-status-row-label">{formatSetupStepLabel(step.name, t)}</span>
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
                    <div class="settings-v2-subsection-title">{t("targetedLearning.health")}</div>
                    <div class="tl-status-health">
                      <div class="tl-status-health-item">
                        <span class="tl-status-health-label">{t("targetedLearning.health.booksDb")}</span>
                        <TargetedLearningStatusBadge
                          status={healthStatus(h().booksDbAvailable, h().setupStatus)}
                          label={healthLabel(
                            h().booksDbAvailable,
                            h().setupStatus,
                            t("targetedLearning.health.available"),
                            h().booksDbReason ?? t("targetedLearning.health.unavailable"),
                          t("targetedLearning.health.pending"),
                          )}
                        />
                      </div>
                      <div class="tl-status-health-item">
                        <span class="tl-status-health-label">{t("targetedLearning.health.manifest")}</span>
                        <TargetedLearningStatusBadge
                          status={healthStatus(h().manifestLoaded, h().setupStatus)}
                          label={healthLabel(h().manifestLoaded, h().setupStatus, t("targetedLearning.health.loaded"), t("targetedLearning.health.missing"))}
                        />
                      </div>
                      <div class="tl-status-health-item">
                        <span class="tl-status-health-label">{t("targetedLearning.health.model")}</span>
                        <TargetedLearningStatusBadge
                          status={healthStatus(h().modelReady, h().setupStatus)}
                          label={healthLabel(h().modelReady, h().setupStatus, t("targetedLearning.status.ready"), t("targetedLearning.health.notReady"))}
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
