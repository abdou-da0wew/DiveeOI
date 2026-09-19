import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export interface FeatureFlagsState {
  memory: boolean
  mcp: boolean
  lsp: boolean
  profiler: boolean
}

export interface LspServerState {
  id: string
  extensions: string[]
  disabled: boolean
}

export interface ServerFeatures {
  features: FeatureFlagsState
  envDisabled: string[]
  lspEnabled: boolean
  lspServers: LspServerState[]
}

export interface ConfigPatch {
  features?: Partial<FeatureFlagsState>
  lsp?: boolean | Record<string, { disabled?: boolean }>
}

const endpoint = (server: ServerConnection.HttpBase, path: string) =>
  new URL(path, server.url.endsWith("/") ? server.url : `${server.url}/`)

const authHeaders = (server: ServerConnection.HttpBase): Record<string, string> => {
  if (!server.password) return {}
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

export async function fetchServerFeatures(server: ServerConnection.HttpBase): Promise<ServerFeatures> {
  const response = await fetch(endpoint(server, "global/features"), {
    headers: authHeaders(server),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Failed to load feature settings (${response.status})`)
  return (await response.json()) as ServerFeatures
}

export async function patchGlobalConfig(server: ServerConnection.HttpBase, patch: ConfigPatch): Promise<void> {
  const response = await fetch(endpoint(server, "global/config"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(server) },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`Failed to save feature settings (${response.status})`)
}

/** Ask the server to restart. Resolves false only when the server explicitly refused the respawn. */
export async function restartServer(server: ServerConnection.HttpBase): Promise<boolean> {
  try {
    const response = await fetch(endpoint(server, "global/restart"), {
      method: "POST",
      headers: authHeaders(server),
    })
    if (!response.ok) return false
    const body = (await response.json()) as { started?: boolean }
    return body.started !== false
  } catch {
    // The old process may drop the connection while exiting — the health poll decides recovery.
    return true
  }
}

/**
 * Poll until the server has restarted: at least one failed health check (old
 * process gone) followed by a successful one (replacement up).
 */
export async function waitUntilRestarted(
  server: ServerConnection.HttpBase,
  { maxWaitMs = 45_000, intervalMs = 400 }: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  let sawDown = false
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint(server, "global/health"), {
        headers: authHeaders(server),
        cache: "no-store",
      })
      if (sawDown && response.ok) return true
    } catch {
      sawDown = true
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}
