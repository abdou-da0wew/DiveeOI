// packages/app/src/components/settings-v2/targeted-learning.tsx
//
// Targeted Learning settings tab (Phase 5 UI, §11.5).
//
// Phase 5: the setup/health state machine and the byte-identical content
// blocks (setup steps, health snapshot) live in
// targeted-learning-settings-state.tsx; this shell only supplies the v2
// chrome (SettingsRowV2, ButtonV2, settings-v2.css classes) around them.

import { TargetedLearningLibrary } from "../targeted-learning-library"
import { TargetedLearningMemory } from "../targeted-learning-memory"
import { TargetedLearningSettingsForm } from "../targeted-learning-settings-form"
import { Component, Show, Suspense } from "solid-js"
import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { TargetedLearningStatusBadge } from "../targeted-learning-status"
import {
  TlHealthSnapshot,
  TlSetupStepsList,
  setupBadgeLabel,
  setupBadgeStatus,
  useTlSetupState,
} from "../targeted-learning-settings-state"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

export const SettingsTargetedLearningV2: Component = () => {
  const language = useLanguage()
  const t = (key: string) => language.t(key as never)
  const state = useTlSetupState()

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
              <Show when={state.status()?.status === "unreachable"}>
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
                  when={state.isReady()}
                  fallback={
                    <div class="flex flex-wrap items-center justify-end gap-2">
                      <TargetedLearningStatusBadge
                        status={setupBadgeStatus(state.status()?.status)}
                        label={setupBadgeLabel(state.status()?.status)}
                      />
                      <Show
                        when={state.isRunning()}
                        fallback={
                          <ButtonV2 onClick={state.start} disabled={state.starting()}>
                            {state.starting() ? t("targetedLearning.setup.starting") : t("targetedLearning.setup.start")}
                          </ButtonV2>
                        }
                      >
                        <ButtonV2 variant="ghost" onClick={state.cancel} disabled={state.starting()}>
                          {t("targetedLearning.setup.cancel")}
                        </ButtonV2>
                      </Show>
                    </div>
                  }
                >
                  <TargetedLearningStatusBadge status="complete" label={t("targetedLearning.status.ready")} />
                </Show>
              </SettingsRowV2>

              <Show when={state.needsRepair()}>
                <SettingsRowV2
                  title={t("targetedLearning.repair")}
                  description={t("targetedLearning.repair.description")}
                >
                  <ButtonV2 variant="ghost" onClick={state.repair} disabled={state.starting()}>
                    {t("targetedLearning.repair")}
                  </ButtonV2>
                </SettingsRowV2>
              </Show>

              {/* Setup steps */}
              <Show when={state.status()?.steps.length}>
                <div class="settings-v2-subsection">
                  <div class="settings-v2-subsection-title">{t("targetedLearning.setupSteps")}</div>
                  <TlSetupStepsList state={state} t={t} />
                </div>
              </Show>

              {/* Health snapshot */}
              <Show when={state.health()}>
                <div class="settings-v2-subsection">
                  <div class="settings-v2-subsection-title">{t("targetedLearning.health")}</div>
                  <TlHealthSnapshot state={state} t={t} />
                </div>
              </Show>

              <TargetedLearningLibrary ready={state.isReady()} />

              <TargetedLearningMemory ready={state.isReady()} />
              <TargetedLearningSettingsForm ready={state.isReady()} v2 />
            </SettingsListV2>
          </Suspense>
        </section>
      </div>
    </>
  )
}
