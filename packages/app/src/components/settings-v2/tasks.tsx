import { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { TasksPanel } from "../tasks-panel"

/**
 * Settings > Tasks tab (draft-10 P4 frontend).
 *
 * Wraps the TasksPanel in the settings-v2 layout so it matches the other
 * settings tabs (header + body). The panel itself handles the
 * list/create/cancel/pause/resume flow via /api/v1/tasks.
 */
export const SettingsTasksV2: Component = () => {
  const language = useLanguage()
  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.tab.tasks")}</h2>
        </div>
        <p class="text-12-regular text-text-weak">
          Autonomous background tasks. Each task runs an agent on a child session; the journal
          survives crashes and resumes via replay.
        </p>
      </div>
      <div class="settings-v2-tab-body">
        <TasksPanel />
      </div>
    </>
  )
}
