// packages/app/src/components/targeted-learning-settings-state.ts
//
// Phase 5 collapse of the v1/v2 Targeted Learning settings duplication: the
// setup/health state machine (resources, polling, actions, derived flags) and
// the two byte-identical content blocks (setup steps list, health snapshot)
// live here ONCE; the v1 and v2 settings shells only supply their own chrome
// (SettingsList vs SettingsListV2, Button vs ButtonV2) around it.

import { Component, For, Show } from "solid-js"
import { createEffect, createResource, createSignal, onCleanup } from "solid-js"
import { formatSetupStepLabel, TargetedLearningStatusBadge } from "./targeted-learning-status"
import { setupIsRunning, useTlApi, type Health, type SetupStatus } from "./targeted-learning-api"

export type { Health, SetupStatus }

export const healthStatus = (available: boolean, setupStatus: string) => {
  if (available) return "complete" as const
  if (setupStatus === "not-started" || setupStatus === "in-progress") return "pending" as const
  return "failed" as const
}

export const healthLabel = (available: boolean, setupStatus: string, ready: string, unavailable: string, pending = "Pending") => {
  if (available) return ready
  if (setupStatus === "not-started" || setupStatus === "in-progress") return pending
  return unavailable
}

export const setupBadgeStatus = (status?: SetupStatus["status"]) => {
  if (status === "ready") return "complete" as const
  if (status === "in-progress") return "running" as const
  if (status === "needs-repair" || status === "unreachable") return "failed" as const
  return "pending" as const
}

export const setupBadgeLabel = (status?: SetupStatus["status"]) => {
  if (!status) return "Checking"
  if (status === "ready") return "Ready"
  if (status === "in-progress") return "Running"
  if (status === "needs-repair") return "Needs repair"
  if (status === "unreachable") return "Offline"
  return "Not set up"
}

type Translate = (key: string) => string

/** Shared setup/health state machine for both settings layouts. */
export function useTlSetupState() {
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

  const run = async (action: () => Promise<unknown>) => {
    setStarting(true)
    try {
      await action()
      await refetch()
    } finally {
      setStarting(false)
    }
  }

  return {
    status,
    health,
    starting,
    start: () => run(() => api.start(false)),
    cancel: () => run(() => api.cancel()),
    repair: () => run(() => api.repair()),
    isReady: () => status()?.status === "ready",
    needsRepair: () => status()?.status === "needs-repair",
    isRunning: () => setupIsRunning(status()),
  }
}

export type TlSetupState = ReturnType<typeof useTlSetupState>

/** The setup-steps list — identical markup in the v1 and v2 shells. */
export const TlSetupStepsList: Component<{ state: TlSetupState; t: Translate }> = (props) => (
  <Show when={props.state.status()?.steps.length}>
    <div class="tl-status-list">
      <For each={props.state.status()!.steps}>
        {(step) => (
          <>
            <div class="tl-status-row">
              <span class="tl-status-row-label">{formatSetupStepLabel(step.name, props.t)}</span>
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
  </Show>
)

/** The health snapshot — identical markup in the v1 and v2 shells. */
export const TlHealthSnapshot: Component<{ state: TlSetupState; t: Translate }> = (props) => (
  <Show when={props.state.health()}>
    {(h) => (
      <div class="tl-status-health">
        <div class="tl-status-health-item">
          <span class="tl-status-health-label">{props.t("targetedLearning.health.booksDb")}</span>
          <TargetedLearningStatusBadge
            status={healthStatus(h().booksDbAvailable, h().setupStatus)}
            label={healthLabel(
              h().booksDbAvailable,
              h().setupStatus,
              props.t("targetedLearning.health.available"),
              h().booksDbReason ?? props.t("targetedLearning.health.unavailable"),
              props.t("targetedLearning.health.pending"),
            )}
          />
        </div>
        <div class="tl-status-health-item">
          <span class="tl-status-health-label">{props.t("targetedLearning.health.manifest")}</span>
          <TargetedLearningStatusBadge
            status={healthStatus(h().manifestLoaded, h().setupStatus)}
            label={healthLabel(
              h().manifestLoaded,
              h().setupStatus,
              props.t("targetedLearning.health.loaded"),
              props.t("targetedLearning.health.missing"),
            )}
          />
        </div>
        <div class="tl-status-health-item">
          <span class="tl-status-health-label">{props.t("targetedLearning.health.model")}</span>
          <TargetedLearningStatusBadge
            status={healthStatus(h().modelReady, h().setupStatus)}
            label={healthLabel(h().modelReady, h().setupStatus, props.t("targetedLearning.status.ready"), props.t("targetedLearning.health.notReady"))}
          />
        </div>
      </div>
    )}
  </Show>
)
