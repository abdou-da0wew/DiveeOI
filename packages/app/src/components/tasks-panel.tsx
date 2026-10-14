import { For, Show, createResource, createSignal, type Component } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { useLanguage } from "@/context/language"
import "./tasks-panel.css"

/**
 * Tasks panel (draft-10 P4 frontend).
 *
 * Lists autonomous tasks created via POST /api/v1/tasks. Each row shows the
 * task prompt, status badge, and last-heartbeat relative time.
 *
 * The "New task" button opens a small form to create a task with a prompt
 * + autoRun toggle. Cancel/pause/resume actions are available on each row.
 */

interface TaskInfo {
  id: string
  sessionID: string
  prompt: string
  status: string
  autoRun: boolean
  error?: string
  createdAt: number
  updatedAt: number
  lastHeartbeat?: number
}

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--color-blue)",
  running: "var(--color-green)",
  paused: "var(--color-yellow)",
  awaiting_permission: "var(--color-orange)",
  done: "var(--color-text-weak)",
  failed: "var(--color-red)",
  cancelled: "var(--color-text-weak)",
  interrupted: "var(--color-red)",
}

function relativeTime(ts: number | undefined): string {
  if (!ts) return "—"
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

export const TasksPanel: Component = () => {
  const serverSDK = useServerSDK()
  const server = useServer()
  const language = useLanguage()

  const authHeaders = (): Record<string, string> => {
    const current = server.current
    if (!current || current.type !== "http") return {}
    const http = current.http
    if (!http.password) return {}
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`,
    }
  }

  const fetchTasks = async (): Promise<TaskInfo[]> => {
    try {
      const res = await fetch(`${serverSDK().url}/api/v1/tasks`, {
        headers: authHeaders(),
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    } catch {
      return []
    }
  }

  const [tasks, { refetch }] = createResource(fetchTasks)
  const [showCreate, setShowCreate] = createSignal(false)
  const [newPrompt, setNewPrompt] = createSignal("")
  const [autoRun, setAutoRun] = createSignal(true)
  const [creating, setCreating] = createSignal(false)

  const createTask = async () => {
    const prompt = newPrompt().trim()
    if (!prompt) return
    setCreating(true)
    try {
      await fetch(`${serverSDK().url}/api/v1/tasks`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, autoRun: autoRun() }),
      })
      setNewPrompt("")
      setShowCreate(false)
      refetch()
    } finally {
      setCreating(false)
    }
  }

  const actionTask = async (id: string, action: "cancel" | "pause" | "resume") => {
    if (action === "cancel") {
      await fetch(`${serverSDK().url}/api/v1/tasks/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      })
    } else {
      await fetch(`${serverSDK().url}/api/v1/tasks/${id}/${action}`, {
        method: "POST",
        headers: authHeaders(),
      })
    }
    refetch()
  }

  return (
    <div class="tasks-panel">
      <div class="tasks-panel-header">
        <h3>{language.t("tasks.title") || "Tasks"}</h3>
        <button class="tasks-panel-create-btn" onClick={() => setShowCreate(!showCreate())}>
          <span>{language.t("tasks.new") || "New task"}</span>
        </button>
      </div>

      <Show when={showCreate()}>
        <div class="tasks-panel-create">
          <textarea
            placeholder={language.t("tasks.promptPlaceholder") || "Describe the task for the agent to perform autonomously..."}
            value={newPrompt()}
            onInput={(e) => setNewPrompt(e.currentTarget.value)}
            rows={3}
          />
          <div class="tasks-panel-create-row">
            <label>
              <input type="checkbox" checked={autoRun()} onChange={(e) => setAutoRun(e.currentTarget.checked)} />
              {language.t("tasks.autoRun") || "Auto-run (start immediately)"}
            </label>
            <button
              class="tasks-panel-create-submit"
              disabled={creating() || !newPrompt().trim()}
              onClick={createTask}
            >
              {creating() ? "..." : language.t("tasks.create") || "Create"}
            </button>
          </div>
        </div>
      </Show>

      <Show when={tasks.loading}>
        <div class="tasks-panel-loading">Loading...</div>
      </Show>

      <Show when={!tasks.loading && tasks() && tasks()!.length === 0}>
        <div class="tasks-panel-empty">
          <p>{language.t("tasks.empty") || "No tasks yet. Create one to run an autonomous agent in the background."}</p>
        </div>
      </Show>

      <div class="tasks-panel-list">
        <For each={tasks() ?? []}>
          {(task) => (
            <div class="tasks-panel-row" data-status={task.status}>
              <div class="tasks-panel-row-header">
                <span
                  class="tasks-panel-status-badge"
                  style={{ "background-color": STATUS_COLORS[task.status] ?? "var(--color-text-weak)" }}
                >
                  {task.status}
                </span>
                <span class="tasks-panel-row-time">{relativeTime(task.lastHeartbeat ?? task.updatedAt)}</span>
              </div>
              <div class="tasks-panel-row-prompt">{task.prompt.slice(0, 200)}</div>
              <Show when={task.error}>
                <div class="tasks-panel-row-error">{task.error}</div>
              </Show>
              <div class="tasks-panel-row-actions">
                <Show when={task.status === "running" || task.status === "queued"}>
                  <button onClick={() => actionTask(task.id, "pause")}>{language.t("tasks.pause") || "Pause"}</button>
                </Show>
                <Show when={task.status === "paused" || task.status === "interrupted"}>
                  <button onClick={() => actionTask(task.id, "resume")}>{language.t("tasks.resume") || "Resume"}</button>
                </Show>
                <Show when={task.status !== "done" && task.status !== "cancelled" && task.status !== "failed"}>
                  <button onClick={() => actionTask(task.id, "cancel")}>{language.t("tasks.cancel") || "Cancel"}</button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
