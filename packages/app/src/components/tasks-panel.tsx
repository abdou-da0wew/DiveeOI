import { For, Show, createResource, createSignal, onCleanup, type Component } from "solid-js"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useProviders } from "@/hooks/use-providers"
import { authTokenFromCredentials } from "@/utils/server"
import { useLanguage } from "@/context/language"
import "./tasks-panel.css"

/**
 * Tasks panel (draft-10 P4 frontend).
 *
 * Lists autonomous tasks and lets one be created with the options a task
 * actually needs: the prompt it runs, the long/short prompt pair, the
 * big/small model pair, the agent that runs it, a cron schedule so the task
 * keeps itself running, and the triggers/actions the task performs for itself.
 *
 * Requests go to the configured server, not to the app's own origin - the
 * panel used relative URLs, which broke against a remote backend.
 */

interface TaskHook {
  trigger: "on_complete" | "on_fail" | "on_timeout" | "on_output_match"
  action: "run_command" | "notify" | "webhook" | "create_task"
  payload?: string
  pattern?: string
}

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
  agent?: string
  bigPrompt?: string
  smallPrompt?: string
  providerID?: string
  modelID?: string
  smallProviderID?: string
  smallModelID?: string
  schedule?: string
  source?: "user" | "agent"
  creatorAgent?: string
  directory?: string
  nextRunAt?: number
  lastRunAt?: number
  runCount?: number
  eventHooks?: string
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

const TRIGGERS: TaskHook["trigger"][] = ["on_complete", "on_fail", "on_timeout", "on_output_match"]
const ACTIONS: TaskHook["action"][] = ["run_command", "notify", "webhook", "create_task"]

function relativeTime(ts: number | undefined): string {
  if (!ts) return "—"
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

export const TasksPanel: Component = () => {
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const language = useLanguage()
  const providers = useProviders()

  const authHeaders = (): Record<string, string> => {
    const current = server.current
    if (!current || current.type !== "http") return {}
    const http = current.http
    if (!http.password) return {}
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`,
    }
  }

  // The task API lives on the configured server, which is not necessarily the
  // origin the app is served from.
  const url = (path: string) => new URL(path, `${serverSDK().url.replace(/\/$/, "")}/`).toString()

  const fetchTasks = async (): Promise<TaskInfo[]> => {
    try {
      const res = await fetch(url("/api/v1/tasks"), { headers: authHeaders() })
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
  const [bigPrompt, setBigPrompt] = createSignal("")
  const [smallPrompt, setSmallPrompt] = createSignal("")
  const [modelKey, setModelKey] = createSignal("")
  const [smallModelKey, setSmallModelKey] = createSignal("")
  const [agent, setAgent] = createSignal("build")
  const [schedule, setSchedule] = createSignal("")
  const [hookTrigger, setHookTrigger] = createSignal<TaskHook["trigger"]>("on_complete")
  const [hookAction, setHookAction] = createSignal<TaskHook["action"]>("run_command")
  const [hookPayload, setHookPayload] = createSignal("")
  const [autoRun, setAutoRun] = createSignal(true)
  const [autoGenerate, setAutoGenerate] = createSignal(true)
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")

  // Keep the list live: a task runs in the background, so the panel has to
  // reflect status changes the user did not trigger.
  const timer = setInterval(() => refetch(), 3000)
  onCleanup(() => clearInterval(timer))

  const modelOptions = () => {
    const out: Array<{ value: string; label: string }> = []
    for (const [providerID, provider] of providers.all()) {
      for (const model of Object.values(provider.models)) {
        out.push({ value: `${providerID}/${model.id}`, label: `${provider.name} · ${model.name}` })
      }
    }
    return out
  }

  const createTask = async () => {
    const prompt = newPrompt().trim()
    if (!prompt) return
    setCreating(true)
    setError("")
    try {
      const [providerID, modelID] = modelKey() ? modelKey().split("/") : []
      const [smallProviderID, smallModelID] = smallModelKey() ? smallModelKey().split("/") : []
      const res = await fetch(url("/api/v1/tasks"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          directory: serverSync().data.path.directory,
          source: "user" as const,
          bigPrompt: bigPrompt().trim() || undefined,
          smallPrompt: smallPrompt().trim() || undefined,
          model: providerID && modelID ? { providerID, modelID } : undefined,
          smallModel: smallProviderID && smallModelID ? { providerID: smallProviderID, modelID: smallModelID } : undefined,
          agent: agent().trim() || undefined,
          schedule: schedule().trim() || undefined,
          autoRun: autoRun(),
          autoGenerate: autoGenerate(),
          hooks: hookPayload().trim()
            ? [{ trigger: hookTrigger(), action: hookAction(), payload: hookPayload().trim() }]
            : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => undefined)
        setError(body?.error?.message ?? `${res.status} ${res.statusText}`)
        return
      }
      setNewPrompt("")
      setBigPrompt("")
      setSmallPrompt("")
      setSchedule("")
      setHookPayload("")
      setShowCreate(false)
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const actionTask = async (id: string, action: "cancel" | "pause" | "resume" | "run" | "generate") => {
    setError("")
    try {
      const res =
        action === "cancel"
          ? await fetch(url(`/api/v1/tasks/${id}`), { method: "DELETE", headers: authHeaders() })
          : await fetch(url(`/api/v1/tasks/${id}/${action}`), { method: "POST", headers: authHeaders() })
      if (!res.ok) {
        const body = await res.json().catch(() => undefined)
        setError(body?.error?.message ?? `${res.status} ${res.statusText}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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

      <Show when={error()}>
        <div class="tasks-panel-row-error">{error()}</div>
      </Show>

      <Show when={showCreate()}>
        <div class="tasks-panel-create">
          <textarea
            placeholder={language.t("tasks.promptPlaceholder") || "Describe the task for the agent to perform autonomously..."}
            value={newPrompt()}
            onInput={(e) => setNewPrompt(e.currentTarget.value)}
            rows={3}
          />
          <label class="tasks-panel-field">
            <span>{language.t("tasks.bigPrompt") || "Big prompt (optional)"}</span>
            <textarea
              placeholder={language.t("tasks.bigPromptPlaceholder") || "The long prompt the task runs..."}
              value={bigPrompt()}
              onInput={(e) => setBigPrompt(e.currentTarget.value)}
              rows={2}
            />
          </label>
          <label class="tasks-panel-field">
            <span>{language.t("tasks.smallPrompt") || "Small prompt (optional)"}</span>
            <textarea
              placeholder={language.t("tasks.smallPromptPlaceholder") || "The cheap prompt used for summaries..."}
              value={smallPrompt()}
              onInput={(e) => setSmallPrompt(e.currentTarget.value)}
              rows={2}
            />
          </label>
          <div class="tasks-panel-field-row">
            <label class="tasks-panel-field">
              <span>{language.t("tasks.model") || "Model"}</span>
              <select value={modelKey()} onChange={(e) => setModelKey(e.currentTarget.value)}>
                <option value="">{language.t("tasks.modelDefault") || "Default model"}</option>
                <For each={modelOptions()}>{(option) => <option value={option.value}>{option.label}</option>}</For>
              </select>
            </label>
            <label class="tasks-panel-field">
              <span>{language.t("tasks.smallModel") || "Small model"}</span>
              <select value={smallModelKey()} onChange={(e) => setSmallModelKey(e.currentTarget.value)}>
                <option value="">{language.t("tasks.modelDefault") || "Default model"}</option>
                <For each={modelOptions()}>{(option) => <option value={option.value}>{option.label}</option>}</For>
              </select>
            </label>
          </div>
          <div class="tasks-panel-field-row">
            <label class="tasks-panel-field">
              <span>{language.t("tasks.agent") || "Agent"}</span>
              <input
                type="text"
                value={agent()}
                placeholder="build"
                onInput={(e) => setAgent(e.currentTarget.value)}
              />
            </label>
            <label class="tasks-panel-field">
              <span>{language.t("tasks.schedule") || "Schedule (cron)"}</span>
              <input
                type="text"
                value={schedule()}
                placeholder="0 9 * * 1-5"
                onInput={(e) => setSchedule(e.currentTarget.value)}
              />
            </label>
          </div>
          <div class="tasks-panel-field-row">
            <label class="tasks-panel-field">
              <span>{language.t("tasks.hookTrigger") || "Trigger"}</span>
              <select
                value={hookTrigger()}
                onChange={(e) => setHookTrigger(e.currentTarget.value as TaskHook["trigger"])}
              >
                <For each={TRIGGERS}>{(value) => <option value={value}>{value}</option>}</For>
              </select>
            </label>
            <label class="tasks-panel-field">
              <span>{language.t("tasks.hookAction") || "Action"}</span>
              <select
                value={hookAction()}
                onChange={(e) => setHookAction(e.currentTarget.value as TaskHook["action"])}
              >
                <For each={ACTIONS}>{(value) => <option value={value}>{value}</option>}</For>
              </select>
            </label>
            <label class="tasks-panel-field">
              <span>{language.t("tasks.hookPayload") || "Payload"}</span>
              <input
                type="text"
                value={hookPayload()}
                placeholder="command, url or prompt"
                onInput={(e) => setHookPayload(e.currentTarget.value)}
              />
            </label>
          </div>
          <div class="tasks-panel-create-row">
            <label>
              <input type="checkbox" checked={autoRun()} onChange={(e) => setAutoRun(e.currentTarget.checked)} />
              {language.t("tasks.autoRun") || "Auto-run (start immediately)"}
            </label>
            <label title={language.t("tasks.autoGenerateDescription")}>
              <input
                type="checkbox"
                checked={autoGenerate()}
                onChange={(e) => setAutoGenerate(e.currentTarget.checked)}
              />
              {language.t("tasks.autoGenerate") || "Let the agent build this task"}
            </label>
          </div>
          <div class="tasks-panel-create-row">
            <span class="tasks-panel-hint">
              {language.t("tasks.autoGenerateDescription") ||
                "The generator agent expands your request into a complete task - prompt, schedule, triggers, agent and models - then stops. The task runs on its own schedule."}
            </span>
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
                <span class="tasks-panel-row-chip" title={language.t("tasks.madeBy")}>
                  {task.source === "agent"
                    ? `${language.t("tasks.madeBy")}: ${task.creatorAgent ?? "agent"}`
                    : language.t("tasks.madeByUser") || "by user"}
                </span>
                <Show when={task.schedule}>
                  <span class="tasks-panel-row-chip" title={task.schedule}>
                    {task.schedule}
                  </span>
                </Show>
                <Show when={task.runCount}>
                  <span class="tasks-panel-row-chip">{`${task.runCount}x`}</span>
                </Show>
                <span class="tasks-panel-row-time">{relativeTime(task.lastHeartbeat ?? task.updatedAt)}</span>
              </div>
              <div class="tasks-panel-row-prompt">{(task.bigPrompt ?? task.prompt).slice(0, 200)}</div>
              <Show when={task.modelID || task.agent}>
                <div class="tasks-panel-row-meta">
                  <Show when={task.agent}>
                    <span>{`agent: ${task.agent}`}</span>
                  </Show>
                  <Show when={task.modelID}>
                    <span>{`model: ${task.providerID}/${task.modelID}`}</span>
                  </Show>
                  <Show when={task.nextRunAt}>
                    <span>{`next: ${new Date(task.nextRunAt!).toLocaleString()}`}</span>
                  </Show>
                </div>
              </Show>
              <Show when={task.error}>
                <div class="tasks-panel-row-error">{task.error}</div>
              </Show>
              <div class="tasks-panel-row-actions">
                <Show when={task.status !== "running"}>
                  <button onClick={() => actionTask(task.id, "run")}>{language.t("tasks.run") || "Run now"}</button>
                </Show>
                <Show when={task.status === "queued" || task.status === "paused"}>
                  <button onClick={() => actionTask(task.id, "generate")}>
                    {language.t("tasks.generate") || "Build with agent"}
                  </button>
                </Show>
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
