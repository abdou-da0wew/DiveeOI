// packages/app/src/components/settings-targeted-learning.tsx
//
// v1 layout — Targeted Learning settings tab.
// Phase 5: the setup/health state machine and the byte-identical content
// blocks (setup steps, health snapshot) live in
// targeted-learning-settings-state.tsx; this shell only supplies the v1
// chrome (SettingsList rows, v1 Buttons, section wrappers) around them.

import { Component, Show, Suspense } from "solid-js"
import { Button } from "@diveeoi/ui/button"
import { TargetedLearningStatusBadge } from "./targeted-learning-status"
import {
  TlHealthSnapshot,
  TlSetupStepsList,
  setupBadgeLabel,
  setupBadgeStatus,
  useTlSetupState,
} from "./targeted-learning-settings-state"
import { useLanguage } from "@/context/language"
import { SettingsList } from "./settings-list"
import { TargetedLearningLibrary } from "./targeted-learning-library"
import { TargetedLearningMemory } from "./targeted-learning-memory"
import { TargetedLearningSettingsForm } from "./targeted-learning-settings-form"

export const SettingsTargetedLearning: Component = () => {
  const language = useLanguage()
  const t = (key: string) => language.t(key as never)
  const state = useTlSetupState()

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
            <Show when={state.status()?.status === "unreachable"}>
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
                when={state.isReady()}
                fallback={
                  <div class="flex items-center gap-2">
                    <TargetedLearningStatusBadge
                      status={setupBadgeStatus(state.status()?.status)}
                      label={setupBadgeLabel(state.status()?.status)}
                    />
                    <Show
                      when={state.isRunning()}
                      fallback={
                        <Button size="small" onClick={state.start} disabled={state.starting()}>
                          {state.starting() ? t("targetedLearning.setup.starting") : t("targetedLearning.setup.start")}
                        </Button>
                      }
                    >
                      <Button size="small" variant="ghost" onClick={state.cancel} disabled={state.starting()}>
                        {t("targetedLearning.setup.cancel")}
                      </Button>
                    </Show>
                  </div>
                }
              >
                <TargetedLearningStatusBadge status="complete" label={t("targetedLearning.status.ready")} />
              </Show>
            </div>

            <Show when={state.needsRepair()}>
              <div class="flex items-center justify-between gap-4 py-4 border-b border-border-weak-base">
                <div class="flex flex-col gap-1">
                  <span class="text-14-medium text-text-strong">{t("targetedLearning.repair")}</span>
                  <span class="text-12-regular text-text-weak">{t("targetedLearning.repair.description.v1")}</span>
                </div>
                <Button size="small" variant="ghost" onClick={state.repair} disabled={state.starting()}>
                  {t("targetedLearning.repair")}
                </Button>
              </div>
            </Show>

            {/* Setup steps */}
            <Show when={state.status()?.steps.length}>
              <div class="py-4 border-b border-border-weak-base">
                <div class="text-14-medium text-text-strong mb-3">{t("targetedLearning.setupSteps")}</div>
                <TlSetupStepsList state={state} t={t} />
              </div>
            </Show>

            {/* Health */}
            <Show when={state.health()}>
              <div class="py-4 border-b border-border-weak-base">
                <div class="text-14-medium text-text-strong mb-3">{t("targetedLearning.health")}</div>
                <TlHealthSnapshot state={state} t={t} />
              </div>
            </Show>

            <TargetedLearningLibrary ready={state.isReady()} />

            <TargetedLearningMemory ready={state.isReady()} />
            <TargetedLearningSettingsForm ready={state.isReady()} />
          </SettingsList>
        </Suspense>
      </div>
    </div>
  )
}
