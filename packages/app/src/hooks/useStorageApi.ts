import { createEffect, type Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"
import { persisted, type PersistTarget } from "@/utils/persist"
import { authTokenFromCredentials } from "@/utils/server"

export interface StorageApiServer {
  url: string
  username?: string
  password?: string
}

export interface StorageApiOptions {
  scope: string
  server: StorageApiServer
}

/**
 * Wraps `persisted()` with optional server-backed sync via the prefs API.
 *
 * When a server config is provided:
 * - On mount (or server connect), fetches prefs from `GET /api/prefs/:scope`
 *   and merges them into the local store.
 * - On local state change, pushes the serialized store to
 *   `PUT /api/prefs/:scope` (debounced 500ms).
 *
 * When no server config is provided, behaves exactly like `persisted()`.
 */
export function useStorageApi<T extends Record<string, any>>(
  target: string | PersistTarget,
  store: [Store<T>, SetStoreFunction<T>],
  options?: Accessor<StorageApiOptions | undefined>,
): [Store<T>, SetStoreFunction<T>, unknown, Accessor<boolean> & { promise: undefined | Promise<any> }] {
  const [state, setState, init, ready] = persisted(target, store)

  // Derive pref name from the persisted target key
  const prefName = typeof target === "string" ? target : target.key

  // Flag to prevent echo loops when writing server data into local store
  let syncingFromServer = false

  // ---- Fetch from server when config becomes available ----
  createEffect(() => {
    const cfg = options?.()
    if (!cfg) return

    let cancelled = false

    const headers: Record<string, string> = {}
    if (cfg.server.password) {
      headers["Authorization"] = `Basic ${authTokenFromCredentials({
        username: cfg.server.username,
        password: cfg.server.password,
      })}`
    }

    syncingFromServer = true

    fetch(`${cfg.server.url}/api/prefs/${cfg.scope}`, { headers })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ data: Array<{ name: string; value: string }> }>) : null,
      )
      .then((result) => {
        if (cancelled || !result) return
        for (const pref of result.data) {
          if (pref.name === prefName) {
            try {
              const parsed = JSON.parse(pref.value)
              if (typeof parsed === "object" && parsed !== null) {
                setState(parsed)
              }
            } catch {
              // Invalid JSON from server — skip
            }
          }
        }
      })
      .catch(() => {
        // Network or server error — silently fall back to local
      })
      .finally(() => {
        if (!cancelled) syncingFromServer = false
      })

    return () => {
      cancelled = true
    }
  })

  // ---- Push to server on local changes (debounced) ----
  createEffect(() => {
    const cfg = options?.()
    // Read serialized state first so we track all store properties reactively,
    // even when we early-return due to sync-in-progress.
    const serialized = JSON.stringify(state)
    if (!cfg || syncingFromServer) return

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (cfg.server.password) {
      headers["Authorization"] = `Basic ${authTokenFromCredentials({
        username: cfg.server.username,
        password: cfg.server.password,
      })}`
    }

    const timer = setTimeout(() => {
      fetch(`${cfg.server.url}/api/prefs/${cfg.scope}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ name: prefName, value: serialized }),
      }).catch(() => {
        // Silently ignore — server may be unreachable
      })
    }, 500)

    return () => clearTimeout(timer)
  })

  return [state, setState, init, ready]
}
