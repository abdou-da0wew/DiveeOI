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

import { Component, For, Show, createEffect, createResource, createSignal, onCleanup, Suspense } from "solid-js"
import { Button } from "@diveeoi/ui/button"
import { formatSetupStepLabel, TargetedLearningStatusBadge } from "./targeted-learning-status"
import { setupIsRunning, useTlApi, type Health, type SetupStatus } from "./targeted-learning-api"
import { useLanguage } from "@/context/language"
import { SettingsList } from "./settings-list"
import { TargetedLearningLibrary } from "./targeted-learning-library"
import { TargetedLearningMemory } from "./targeted-learning-memory"
import { TargetedLearningSettingsForm } from "./targeted-learning-settings-form"

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

export const SettingsTargetedLearning: Component = () => {
  const language = useLanguage()
  const t = (key: string) => language.t(key as never)
  const api = useTlApi()
  const [status, { refetch }] = createResource<SetupStatus>(api.getStatus)
  const [health] = createResource<Health>(api.getHealth)
  const [starting, setStarting] = createSignal(false)

  // Setup runs on the server in the background — poll while it is in progress.
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
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col flex-1 min-h-0 max-w-[720px]">
        <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
          <div class="flex flex-col gap-1 pt-6 pb-8">
            <h2 class="text-16-medium text-text-strong">{t("targetedLearning.tab.title")}</h2>
            <p class="text-12-regular text-text-weak">{t("targetedLearning.tab.description.short")}</p>
          </div>
        </div>

        <Suspense fallback={<div class="text-12-regular text-text-weak">Loading…</div>}>
          <SettingsList>
            {/* Backend unreachable notice */}
            <Show when={status()?.status === "unreachable"}>
              <div class="flex items-center justify-between gap-4 py-4 border-b border-border-weak-base">
                <div class="flex flex-col gap-1">
                  <span class="text-14-medium text-text-strong">{t("targetedLearning.unreachable.title")}</span>
                  <span class="text-12-regular text-text-weak">{t("targetedLearning.unreachable.description.v1")}</span>
                </div>
                <TargetedLearningStatusBadge status="failed" label={t("targetedLearning.status.offline")} />
              </div>
            </Show>

            {/* Setup */}
            <div class="flex items-center justify-between gap-4 py-4 border-b border-border-weak-base">
              <div class="flex flex-col gap-1">
                <span class="text-14-medium text-text-strong">{t("targetedLearning.setup.title")}</span>
                <span class="text-12-regular text-text-weak">{t("targetedLearning.setup.description.v1")}</span>
              </div>
              <Show
                when={isReady()}
                fallback={
                  <div class="flex items-center gap-2">
                    <TargetedLearningStatusBadge
                      status={setupBadgeStatus(status()?.status)}
                      label={setupBadgeLabel(status()?.status)}
                    />
                    <Show
                      when={isRunning()}
                      fallback={
                        <Button size="small" onClick={start} disabled={starting()}>
                          {starting() ? t("targetedLearning.setup.starting") : t("targetedLearning.setup.start")}
                        </Button>
                      }
                    >
                      <Button size="small" variant="ghost" onClick={cancel} disabled={starting()}>
                        {t("targetedLearning.setup.cancel")}
                      </Button>
                    </Show>
                  </div>
                }
              >
                <TargetedLearningStatusBadge status="complete" label={t("targetedLearning.status.ready")} />
              </Show>
            </div>

            <Show when={needsRepair()}>
              <div class="flex items-center justify-between gap-4 py-4 border-b border-border-weak-base">
                <div class="flex flex-col gap-1">
                  <span class="text-14-medium text-text-strong">{t("targetedLearning.repair")}</span>
                  <span class="text-12-regular text-text-weak">{t("targetedLearning.repair.description.v1")}</span>
                </div>
                <Button size="small" variant="ghost" onClick={repair} disabled={starting()}>
                  {t("targetedLearning.repair")}
                </Button>
              </div>
            </Show>

            {/* Setup steps */}
            <Show when={status()?.steps.length}>
              <div class="py-4 border-b border-border-weak-base">
                <div class="text-14-medium text-text-strong mb-3">{t("targetedLearning.setupSteps")}</div>
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

            {/* Health */}
            <Show when={health()}>
              {(h) => (
                <div class="py-4 border-b border-border-weak-base">
                  <div class="text-14-medium text-text-strong mb-3">{t("targetedLearning.health")}</div>
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
            <TargetedLearningSettingsForm ready={isReady()} />
          </SettingsList>
        </Suspense>
      </div>
    </div>
  )
}
