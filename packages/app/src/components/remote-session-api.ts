import { authFetch } from "@/utils/auth-client"

export type RemoteAuthMethod = "password" | "privateKey" | "agent"

export interface RemoteProfile {
  id: string
  name: string
  host: string
  port: number
  user: string
  workingDirectory: string
  authMethod: RemoteAuthMethod
  keyPath?: string
  createdAt: number
  updatedAt: number
}

export interface RemoteHost {
  id: string
  name: string
  host: string
  port: number
  user: string
  identityFile?: string
  proxyJump?: string
  sources: Array<"ssh_config" | "known_hosts">
}

export interface RemoteSSHKey {
  name: string
  path: string
  publicKeyPath: string
  publicKey: string
  type: string
  comment: string
}

export interface RemoteDiscovery {
  hosts: RemoteHost[]
  identities: Array<{ type: string; comment: string; source: "agent" }>
  sources: {
    sshConfig: string
    knownHosts: string
    keyDirectory: string
    agentAvailable: boolean
  }
}

export interface RemoteProfileInput {
  id?: string
  name: string
  host: string
  port: number
  user: string
  workingDirectory: string
  authMethod: RemoteAuthMethod
  keyPath?: string
  password?: string
  passphrase?: string
}

export function createRemoteSessionApi(input: { base: () => string; headers: () => Record<string, string> }) {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await authFetch(`${input.base()}${path}`, {
      ...init,
      headers: {
        ...input.headers(),
        "Content-Type": "application/json",
        ...init.headers,
      },
    })
    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Remote request failed (${response.status})`)
    }
    return (await response.json()) as T
  }

  return {
    discovery: () => request<{ ok: true } & RemoteDiscovery>("/api/v1/remote/discovery"),
    profiles: async () => (await request<{ ok: true; profiles: RemoteProfile[] }>("/api/v1/remote/profiles")).profiles,
    keys: async () => (await request<{ ok: true; keys: RemoteSSHKey[] }>("/api/v1/remote/keys")).keys,
    saveProfile: (profile: RemoteProfileInput) =>
      request<{ ok: true; profile: RemoteProfile }>("/api/v1/remote/profiles", {
        method: "POST",
        body: JSON.stringify(profile),
      }),
    deleteProfile: (id: string) =>
      request<{ ok: true; removed: boolean }>(`/api/v1/remote/profiles/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    probeProfile: (id: string) =>
      request<{ ok: boolean; platform?: string; homeDirectory?: string; reason?: string }>(
        `/api/v1/remote/profiles/${encodeURIComponent(id)}/probe`,
        { method: "POST" },
      ),
    generateKey: (name: string) =>
      request<{ ok: true; key: { name: string; path: string; publicKeyPath: string; publicKey: string } }>(
        "/api/v1/remote/keys",
        { method: "POST", body: JSON.stringify({ name }) },
      ),
    updateSession: (sessionId: string, remote: { profileId: string; workingDirectory: string } | null) =>
      request<Record<string, unknown>>(`/api/session/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        body: JSON.stringify({ metadata: { remote } }),
      }),
  }
}
