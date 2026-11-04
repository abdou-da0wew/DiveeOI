// packages/app/src/components/targeted-learning-api.ts
//
// Shared Targeted Learning settings API used by both the v1 and v2 settings
// tabs (they previously each carried a copy-pasted useTlApi that drifted).
// Includes setup polling (the server runs setup in the background and the
// docs say to poll GET /setup) and the setup-cancel endpoint.

import { authFetch } from "@/utils/auth-client"
import { useServerSDK } from "@/context/server-sdk"

export interface SetupStep {
  name: string
  status: "pending" | "running" | "complete" | "failed" | "skipped"
  attempts: number
  lastError?: string
}

export interface SetupStatus {
  status: "not-started" | "in-progress" | "ready" | "needs-repair" | "unreachable"
  steps: SetupStep[]
  recommendedProfile?: "low" | "balanced" | "high"
}

export interface Health {
  setupStatus: string
  booksDbAvailable: boolean
  booksDbReason?: string
  modelReady: boolean
  manifestLoaded: boolean
}

export const UNREACHABLE_SETUP: SetupStatus = { status: "unreachable", steps: [] }

export const useTlApi = () => {
  const serverSDK = useServerSDK()
  const base = () => serverSDK().url
  const headers = { "content-type": "application/json" } as Record<string, string>

  const getJson = async <T>(path: string, init?: RequestInit, fallback?: T): Promise<T> => {
    const resp = await authFetch(`${base()}${path}`, { headers, ...init })
    if (!resp.ok) throw new Error(`${path}: ${resp.status}`)
    return (await resp.json()) as T
  }

  return {
    getStatus: (): Promise<SetupStatus> =>
      getJson<SetupStatus>("/targeted-learning/setup").catch(() => UNREACHABLE_SETUP),
    start: (force = false): Promise<SetupStatus> =>
      getJson<SetupStatus>("/targeted-learning/setup/start", { method: "POST", body: JSON.stringify({ force }) }).catch(
        () => UNREACHABLE_SETUP,
      ),
    cancel: (): Promise<SetupStatus> =>
      getJson<SetupStatus>("/targeted-learning/setup/cancel", { method: "POST" }).catch(() => UNREACHABLE_SETUP),
    repair: (): Promise<SetupStatus> =>
      getJson<SetupStatus>("/targeted-learning/setup/repair", { method: "POST" }).catch(() => UNREACHABLE_SETUP),
    getHealth: (): Promise<Health> =>
      getJson<Health>("/targeted-learning/health").catch(() => ({
        setupStatus: "unreachable",
        booksDbAvailable: false,
        modelReady: false,
        manifestLoaded: false,
      })),
  }
}

/**
 * True while the setup should be polled (`in-progress`); the server performs
 * downloads/probes in the background and documents that the UI polls GET /setup.
 */
export const setupIsRunning = (status?: SetupStatus): boolean => status?.status === "in-progress"
