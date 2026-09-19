import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "@/context/server"
import {
  fetchServerFeatures,
  patchGlobalConfig,
  restartServer,
  waitUntilRestarted,
  type FeatureFlagsState,
  type LspServerState,
} from "@/utils/server-features"

export interface FeaturesSettingsState {
  loading: boolean
  loadError: string
  error: string
  restartFailed: boolean
  busy: boolean
  restarting: boolean
  features: FeatureFlagsState
  envDisabled: string[]
  lspEnabled: boolean
  lspServers: LspServerState[]
}

/**
 * Shared state machine for the Features settings tab (v1 and v2 dialogs).
 * Toggles update local state immediately, batch into one config patch, and
 * after a short idle window the patch is saved and the server is restarted.
 * The restart overlay stays up until the health endpoint answers again, then
 * the page reloads.
 */
export function createFeaturesSettings() {
  const server = useServer()

  const [state, setState] = createStore<FeaturesSettingsState>({
    loading: true,
    loadError: "",
    error: "",
    restartFailed: false,
    busy: false,
    restarting: false,
    features: { memory: true, mcp: true, lsp: true, profiler: true },
    envDisabled: [],
    lspEnabled: true,
    lspServers: [],
  })

  let pendingFeatures: Partial<FeatureFlagsState> | undefined
  let pendingLspMaster: boolean | undefined
  let pendingLspServers: Record<string, { disabled: boolean }> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const http = () => server.current?.http

  const load = async () => {
    const conn = http()
    if (!conn) {
      setState({ loading: false, loadError: "No server connection" })
      return
    }
    setState({ loading: true, loadError: "" })
    try {
      const data = await fetchServerFeatures(conn)
      setState({
        loading: false,
        features: { ...data.features },
        envDisabled: [...data.envDisabled],
        lspEnabled: data.lspEnabled,
        lspServers: data.lspServers.map((item) => ({ ...item, extensions: [...item.extensions] })),
      })
    } catch (err) {
      setState({ loading: false, loadError: err instanceof Error ? err.message : String(err) })
    }
  }
  void load()

  const apply = async () => {
    const conn = http()
    if (!conn) return
    const patch: { features?: Partial<FeatureFlagsState>; lsp?: boolean | Record<string, { disabled: boolean }> } = {}
    if (pendingFeatures) patch.features = pendingFeatures
    if (pendingLspMaster !== undefined) patch.lsp = pendingLspMaster
    else if (pendingLspServers && Object.keys(pendingLspServers).length > 0) patch.lsp = pendingLspServers
    pendingFeatures = undefined
    pendingLspMaster = undefined
    pendingLspServers = undefined
    if (!patch.features && !patch.lsp) return

    setState({ busy: true, error: "" })
    try {
      await patchGlobalConfig(conn, patch)
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) })
      return
    }

    // Saved. Restart so the flags are re-resolved from the config file.
    setState({ restarting: true })
    const started = await restartServer(conn)
    if (!started) {
      setState({ restarting: false, busy: false, restartFailed: true })
      return
    }
    const back = await waitUntilRestarted(conn)
    if (back) {
      window.location.reload()
      return
    }
    setState({ restarting: false, busy: false, restartFailed: true })
  }

  const scheduleApply = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void apply(), 1200)
  }
  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  const envDisabled = (key: keyof FeatureFlagsState) => state.envDisabled.includes(key)

  const toggleFeature = (key: keyof FeatureFlagsState, checked: boolean) => {
    if (state.busy || state.restarting || envDisabled(key)) return
    setState("features", key, checked)
    pendingFeatures = { ...pendingFeatures, [key]: checked }
    scheduleApply()
  }

  const toggleLspMaster = (checked: boolean) => {
    if (state.busy || state.restarting) return
    setState("lspEnabled", checked)
    pendingLspMaster = checked
    if (!checked) pendingLspServers = undefined
    scheduleApply()
  }

  const toggleLspServer = (id: string, disabled: boolean) => {
    if (state.busy || state.restarting || !state.lspEnabled) return
    const index = state.lspServers.findIndex((item) => item.id === id)
    if (index >= 0) setState("lspServers", index, "disabled", disabled)
    pendingLspServers = { ...pendingLspServers, [id]: { disabled } }
    scheduleApply()
  }

  return {
    state,
    envDisabled,
    toggleFeature,
    toggleLspMaster,
    toggleLspServer,
    reload: load,
  }
}

export type FeaturesSettings = ReturnType<typeof createFeaturesSettings>

export const FEATURE_ROWS: Array<{ key: keyof FeatureFlagsState; title: string; description: string }> = [
  {
    key: "memory",
    title: "Memory",
    description: "Session memory: extraction, background scheduler, and the agent's memory tools",
  },
  {
    key: "mcp",
    title: "MCP",
    description: "MCP client connections and the tools, prompts, and resources they provide",
  },
  {
    key: "lsp",
    title: "LSP",
    description: "Language servers that give the agent diagnostics and code intelligence",
  },
  {
    key: "profiler",
    title: "Profiler",
    description: "Startup profiler instrumentation",
  },
]
