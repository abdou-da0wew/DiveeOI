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

export interface RemoteProfileInput {
  id?: string
  name: string
  host: string
  port?: number
  user: string
  workingDirectory?: string
  authMethod: RemoteAuthMethod
  keyPath?: string
  password?: string
  passphrase?: string
}

export interface RemoteSessionReference {
  profileId: string
  workingDirectory?: string
}

export interface ResolvedRemoteProfile extends RemoteProfile {
  auth:
    | { kind: "password"; password: string }
    | { kind: "privateKey"; keyPath: string; passphrase?: string }
    | { kind: "agent"; socketPath?: string }
}

export interface DiscoveredSSHHost {
  id: string
  name: string
  host: string
  port: number
  user: string
  identityFile?: string
  proxyJump?: string
  sources: Array<"ssh_config" | "known_hosts">
}

export interface SSHIdentity {
  comment: string
  type: string
  source: "agent"
}
