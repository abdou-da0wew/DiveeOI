import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { TextInputV2 } from "@diveeoi/ui/v2/text-input-v2"
import { type Component, For, Show } from "solid-js"
import type { RemoteDiscovery, RemoteHost, RemoteProfile, RemoteSSHKey } from "../remote-session-api"
import { SettingsListV2 } from "./parts/list"

export interface ActiveRemoteSession {
  id: string
  title: string
  directory: string
  metadata?: Record<string, unknown>
}

export const RemoteSessionsContent: Component<{
  discovery?: RemoteDiscovery
  profiles: RemoteProfile[]
  keys: RemoteSSHKey[]
  sessions: ActiveRemoteSession[]
  keyName: string
  busy: boolean
  onKeyName: (value: string) => void
  onDisconnect: (session: ActiveRemoteSession) => void
  onTest: (profile: RemoteProfile) => void
  onEdit: (profile: RemoteProfile) => void
  onDelete: (profile: RemoteProfile) => void
  onUseHost: (host: RemoteHost) => void
  onGenerateKey: () => void
}> = (props) => {
  const profileName = (session: ActiveRemoteSession) => {
    const remote = session.metadata?.remote
    if (typeof remote !== "object" || remote === null) return "Remote profile"
    const id = (remote as { profileId?: unknown }).profileId
    if (typeof id !== "string") return "Remote profile"
    return props.profiles.find((profile) => profile.id === id)?.name ?? id
  }

  return (
    <>
      <section class="settings-v2-section">
        <h3 class="settings-v2-section-title">Active remote sessions</h3>
        <SettingsListV2>
          <Show
            when={props.sessions.length > 0}
            fallback={<div class="settings-v2-remote-empty">No sessions are currently attached to an SSH host.</div>}
          >
            <For each={props.sessions}>
              {(session) => (
                <div class="settings-v2-remote-card">
                  <div class="settings-v2-remote-card-copy">
                    <div class="settings-v2-remote-card-title">{session.title || session.id}</div>
                    <div class="settings-v2-remote-card-meta">
                      {profileName(session)} · {session.directory}
                    </div>
                  </div>
                  <ButtonV2
                    size="small"
                    variant="ghost-muted"
                    onClick={() => props.onDisconnect(session)}
                    disabled={props.busy}
                  >
                    Disconnect
                  </ButtonV2>
                </div>
              )}
            </For>
          </Show>
        </SettingsListV2>
      </section>

      <section class="settings-v2-section">
        <h3 class="settings-v2-section-title">Saved SSH hosts</h3>
        <SettingsListV2>
          <Show
            when={props.profiles.length > 0}
            fallback={
              <div class="settings-v2-remote-empty">
                No saved profiles yet. Add a host or choose one from SSH discovery.
              </div>
            }
          >
            <For each={props.profiles}>
              {(profile) => (
                <div class="settings-v2-remote-card">
                  <div class="settings-v2-remote-card-copy">
                    <div class="settings-v2-remote-card-title">{profile.name}</div>
                    <div class="settings-v2-remote-card-meta">
                      {profile.user}@{profile.host}:{profile.port} · {profile.authMethod} · {profile.workingDirectory}
                    </div>
                  </div>
                  <div class="settings-v2-remote-card-actions">
                    <ButtonV2
                      size="small"
                      variant="ghost-muted"
                      onClick={() => props.onTest(profile)}
                      disabled={props.busy}
                    >
                      Test
                    </ButtonV2>
                    <ButtonV2
                      size="small"
                      variant="ghost-muted"
                      onClick={() => props.onEdit(profile)}
                      disabled={props.busy}
                    >
                      Edit
                    </ButtonV2>
                    <ButtonV2
                      size="small"
                      variant="ghost-muted"
                      onClick={() => props.onDelete(profile)}
                      disabled={props.busy}
                    >
                      Delete
                    </ButtonV2>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </SettingsListV2>
      </section>

      <section class="settings-v2-section">
        <h3 class="settings-v2-section-title">SSH host discovery</h3>
        <p class="settings-v2-remote-help">
          Reads OpenSSH config files (including Include directives), known_hosts, key pairs, and loaded SSH-agent
          identities. Discovery is local to the machine running the DiveeOI server.
        </p>
        <SettingsListV2>
          <For each={props.discovery?.hosts ?? []}>
            {(host) => (
              <div class="settings-v2-remote-card">
                <div class="settings-v2-remote-card-copy">
                  <div class="settings-v2-remote-card-title">{host.name}</div>
                  <div class="settings-v2-remote-card-meta">
                    {host.user}@{host.host}:{host.port} · {host.sources.join(", ")}
                    <Show when={host.identityFile}> · {host.identityFile}</Show>
                  </div>
                </div>
                <ButtonV2
                  size="small"
                  variant="ghost-muted"
                  onClick={() => props.onUseHost(host)}
                  disabled={props.busy}
                >
                  Use host
                </ButtonV2>
              </div>
            )}
          </For>
          <Show when={!props.discovery?.hosts.length}>
            <div class="settings-v2-remote-empty">
              No configured hosts found in the OpenSSH config or known_hosts file.
            </div>
          </Show>
        </SettingsListV2>
        <div class="settings-v2-remote-meta">
          <span>SSH config: {props.discovery?.sources.sshConfig ?? "—"}</span>
          <span>Known hosts: {props.discovery?.sources.knownHosts ?? "—"}</span>
          <span>Agent: {props.discovery?.sources.agentAvailable ? "Available" : "Not available"}</span>
          <Show when={props.discovery?.identities.length}>
            <span>Agent identities: {props.discovery?.identities.map((identity) => identity.comment).join(", ")}</span>
          </Show>
        </div>
      </section>

      <section class="settings-v2-section">
        <h3 class="settings-v2-section-title">SSH keys</h3>
        <div class="settings-v2-remote-key-create">
          <TextInputV2
            appearance="base"
            value={props.keyName}
            placeholder="Key name"
            onInput={(event) => props.onKeyName(event.currentTarget.value)}
          />
          <ButtonV2 variant="ghost-muted" onClick={props.onGenerateKey} disabled={props.busy || !props.keyName.trim()}>
            Generate Ed25519 key
          </ButtonV2>
        </div>
        <SettingsListV2>
          <Show
            when={props.keys.length > 0}
            fallback={
              <div class="settings-v2-remote-empty">
                No matching SSH key pairs found in the configured key directory.
              </div>
            }
          >
            <For each={props.keys}>
              {(key) => (
                <div class="settings-v2-remote-key">
                  <div class="settings-v2-remote-card-title">
                    {key.name} <span>{key.type}</span>
                  </div>
                  <div class="settings-v2-remote-card-meta">{key.path}</div>
                  <div class="settings-v2-remote-public-key">{key.publicKey}</div>
                  <ButtonV2
                    size="small"
                    variant="ghost-muted"
                    onClick={() => void navigator.clipboard?.writeText(key.publicKey)}
                  >
                    Copy public key
                  </ButtonV2>
                </div>
              )}
            </For>
          </Show>
        </SettingsListV2>
      </section>
    </>
  )
}
