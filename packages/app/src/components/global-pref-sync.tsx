import { createEffect, onCleanup } from "solid-js"
import { useSettings } from "@/context/settings"
import { useModels } from "@/context/models"
import { usePermission } from "@/context/permission"
import { useGlobal } from "@/context/global"
import { useServerSDK } from "@/context/server-sdk"
import { authTokenFromCredentials } from "@/utils/server"

const GLOBAL_SCOPE = "global"
const SETTINGS_PREF = "settings.v3"
const MODELS_PREF = "model"
const PERMISSION_PREF = "permission"

function getAuthHeaders(conn: { http?: { username?: string; password?: string } }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (conn.http?.password) {
    headers["Authorization"] = `Basic ${authTokenFromCredentials({
      username: conn.http.username ?? "",
      password: conn.http.password,
    })}`
  }
  return headers
}

/**
 * Syncs settings, model preferences, and permission auto-accept rules
 * to/from the server prefs API.
 *
 * Mounted inside ServerScopedShell (after PermissionProvider, ModelsProvider)
 * so all context stores are available. On connect to a server, fetches
 * saved prefs and merges them into each local store. On local changes,
 * debounces 500ms and pushes the full state to the server.
 */
export function GlobalPrefSync() {
  const settings = useSettings()
  const models = useModels()
  const permission = usePermission()
  const global = useGlobal()
  const serverSDK = useServerSDK()

  // Flag to prevent echo loops when writing server data into local store
  let syncingFromServer = false

  // ---------------------------------------------------------------------------
  // Helper: create a sync pair (fetch + push) for a given pref name and scope.
  // Takes a store reader and a store setter to reconcile into.
  // ---------------------------------------------------------------------------
  function createPrefSync<T>(
    prefName: string,
    scope: () => string,
    read: () => T,
    write: (v: T) => void,
  ) {
    // ---- Fetch from server on connect ----
    createEffect(() => {
      const conn = global.settings.server.selected()
      const scopeValue = scope()
      if (!conn || !scopeValue) return

      let cancelled = false
      const headers = getAuthHeaders(conn)

      syncingFromServer = true

      fetch(`${conn.http.url}/api/prefs/${scopeValue}`, { headers })
        .then(
          (r) =>
            r.ok
              ? (r.json() as Promise<{ data: Array<{ name: string; value: string }> }>)
              : null,
        )
        .then((result) => {
          if (cancelled || !result) return
          for (const pref of result.data) {
            if (pref.name === prefName) {
              try {
                const parsed = JSON.parse(pref.value)
                if (typeof parsed === "object" && parsed !== null) {
                  write(parsed as T)
                }
              } catch {
                // Invalid JSON from server — keep local
              }
            }
          }
        })
        .catch(() => {
          // Network error — fall back to local
        })
        .finally(() => {
          if (!cancelled) syncingFromServer = false
        })

      onCleanup(() => {
        cancelled = true
      })
    })

    // ---- Push to server on local changes (debounced 500ms) ----
    createEffect(() => {
      const conn = global.settings.server.selected()
      const scopeValue = scope()
      // Read state for reactive tracking even when no server
      const serialized = JSON.stringify(read())
      if (!conn || !scopeValue || syncingFromServer) return

      const headers = getAuthHeaders(conn)

      const timer = setTimeout(() => {
        fetch(`${conn.http.url}/api/prefs/${scopeValue}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ name: prefName, value: serialized }),
        }).catch(() => {
          // Server unreachable — next change will retry
        })
      }, 500)

      onCleanup(() => clearTimeout(timer))
    })
  }

  // ---------------------------------------------------------------------------
  // Settings.v3 (global scope)
  // ---------------------------------------------------------------------------
  createPrefSync(
    SETTINGS_PREF,
    () => GLOBAL_SCOPE,
    () => settings.current,
    (v) => settings.setStore(v),
  )

  // ---------------------------------------------------------------------------
  // Model preferences (global scope)
  // ---------------------------------------------------------------------------
  createPrefSync(
    MODELS_PREF,
    () => GLOBAL_SCOPE,
    () => models.value,
    (v) => models.setStore(v),
  )

  // ---------------------------------------------------------------------------
  // Permission auto-accept rules (server-scoped)
  // ---------------------------------------------------------------------------
  createPrefSync(
    PERMISSION_PREF,
    () => serverSDK().scope,
    () => permission.value,
    (v) => permission.setStore(v),
  )

  return null
}
