import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { SelectV2 } from "@diveeoi/ui/v2/select-v2"
import { TextInputV2 } from "@diveeoi/ui/v2/text-input-v2"
import { type Component, Show } from "solid-js"
import type { RemoteAuthMethod, RemoteSSHKey } from "../remote-session-api"

export interface RemoteProfileFormState {
  id: string
  name: string
  host: string
  port: string
  user: string
  workingDirectory: string
  authMethod: RemoteAuthMethod
  keyPath: string
  password: string
  passphrase: string
}

const authOptions: Array<{ value: RemoteAuthMethod; label: string }> = [
  { value: "agent", label: "SSH agent" },
  { value: "privateKey", label: "Private key" },
  { value: "password", label: "Password" },
]

export const RemoteSessionsProfileForm: Component<{
  form: RemoteProfileFormState
  keys: RemoteSSHKey[]
  busy: boolean
  onChange: (key: keyof RemoteProfileFormState, value: string | RemoteAuthMethod) => void
  onSave: () => void
  onCancel: () => void
}> = (props) => (
  <section class="settings-v2-section settings-v2-remote-form-section">
    <h3 class="settings-v2-section-title">{props.form.id ? "Edit SSH profile" : "New SSH profile"}</h3>
    <div class="settings-v2-remote-form">
      <label for="remote-profile-name">
        <span>Profile name</span>
        <TextInputV2
          appearance="base"
          id="remote-profile-name"
          value={props.form.name}
          onInput={(event) => props.onChange("name", event.currentTarget.value)}
        />
      </label>
      <label for="remote-profile-host">
        <span>Host / address</span>
        <TextInputV2
          appearance="base"
          id="remote-profile-host"
          value={props.form.host}
          placeholder="host.example.com"
          onInput={(event) => props.onChange("host", event.currentTarget.value)}
        />
      </label>
      <label for="remote-profile-user">
        <span>Username</span>
        <TextInputV2
          appearance="base"
          id="remote-profile-user"
          value={props.form.user}
          placeholder="ubuntu"
          onInput={(event) => props.onChange("user", event.currentTarget.value)}
        />
      </label>
      <label for="remote-profile-port">
        <span>Port</span>
        <TextInputV2
          appearance="base"
          type="number"
          id="remote-profile-port"
          value={props.form.port}
          onInput={(event) => props.onChange("port", event.currentTarget.value)}
        />
      </label>
      <label class="settings-v2-remote-form-wide" for="remote-profile-directory">
        <span>Remote working directory</span>
        <TextInputV2
          appearance="base"
          id="remote-profile-directory"
          value={props.form.workingDirectory}
          placeholder="~ or /home/user/project"
          onInput={(event) => props.onChange("workingDirectory", event.currentTarget.value)}
        />
      </label>
      <div class="settings-v2-remote-field">
        <span>Authentication</span>
        <SelectV2
          aria-label="Authentication"
          appearance="inline"
          options={authOptions}
          current={authOptions.find((option) => option.value === props.form.authMethod)}
          value={(option) => option.value}
          label={(option) => option.label}
          onSelect={(option) => option && props.onChange("authMethod", option.value)}
        />
      </div>
      <Show when={props.form.authMethod === "privateKey"}>
        <div class="settings-v2-remote-field">
          <span>Private key</span>
          <SelectV2
            aria-label="Private key file"
            appearance="inline"
            options={props.keys}
            current={props.keys.find((key) => key.path === props.form.keyPath)}
            value={(key) => key.path}
            label={(key) => key.name}
            onSelect={(key) => key && props.onChange("keyPath", key.path)}
          />
        </div>
        <label class="settings-v2-remote-form-wide" for="remote-profile-key-path">
          <span>Private key path</span>
          <TextInputV2
            appearance="base"
            id="remote-profile-key-path"
            value={props.form.keyPath}
            placeholder="~/.ssh/id_ed25519"
            onInput={(event) => props.onChange("keyPath", event.currentTarget.value)}
          />
        </label>
        <label class="settings-v2-remote-form-wide" for="remote-profile-key-passphrase">
          <span>Key passphrase</span>
          <TextInputV2
            appearance="base"
            type="password"
            id="remote-profile-key-passphrase"
            value={props.form.passphrase}
            placeholder="Leave blank if the key is not encrypted"
            onInput={(event) => props.onChange("passphrase", event.currentTarget.value)}
          />
        </label>
      </Show>
      <Show when={props.form.authMethod === "password"}>
        <label class="settings-v2-remote-form-wide" for="remote-profile-password">
          <span>SSH password</span>
          <TextInputV2
            appearance="base"
            type="password"
            id="remote-profile-password"
            value={props.form.password}
            placeholder={props.form.id ? "Leave blank to keep the saved password" : "SSH password"}
            onInput={(event) => props.onChange("password", event.currentTarget.value)}
          />
        </label>
      </Show>
      <div class="settings-v2-remote-form-actions settings-v2-remote-form-wide">
        <ButtonV2 variant="ghost-muted" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </ButtonV2>
        <ButtonV2 onClick={props.onSave} disabled={props.busy}>
          {props.form.id ? "Save changes" : "Save profile"}
        </ButtonV2>
      </div>
    </div>
  </section>
)
