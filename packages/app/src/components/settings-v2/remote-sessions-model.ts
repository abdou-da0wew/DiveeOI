import type { RemoteDiscovery, RemoteProfile, RemoteSSHKey } from "../remote-session-api"
import type { ActiveRemoteSession } from "./remote-sessions-content"
import type { RemoteProfileFormState } from "./remote-sessions-form"

export type RemoteSettingsData = {
  discovery: RemoteDiscovery
  profiles: RemoteProfile[]
  keys: RemoteSSHKey[]
  sessions: ActiveRemoteSession[]
}

export const emptyRemoteProfileForm = (): RemoteProfileFormState => ({
  id: "",
  name: "",
  host: "",
  port: "22",
  user: "",
  workingDirectory: "~",
  authMethod: "agent",
  keyPath: "",
  password: "",
  passphrase: "",
})
