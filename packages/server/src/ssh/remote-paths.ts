import os from "node:os"
import path from "node:path"

const home = os.homedir()

export function expandRemotePath(value: string) {
  if (value === "~") return home
  if (value.startsWith("~/")) return path.join(home, value.slice(2))
  return value
}

export function remoteConfigDirectory() {
  return path.resolve(
    expandRemotePath(
      process.env.DIVEEOI_REMOTE_CONFIG_DIR ??
        path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "diveeoi"),
    ),
  )
}

export function sshKeyDirectory() {
  return path.resolve(expandRemotePath(process.env.DIVEEOI_SSH_KEY_DIR ?? path.join(home, ".ssh")))
}

export function sshConfigFile() {
  return path.resolve(expandRemotePath(process.env.DIVEEOI_SSH_CONFIG_FILE ?? path.join(sshKeyDirectory(), "config")))
}

export function sshKnownHostsFile() {
  return path.resolve(
    expandRemotePath(process.env.DIVEEOI_SSH_KNOWN_HOSTS_FILE ?? path.join(sshKeyDirectory(), "known_hosts")),
  )
}

export function remoteProfilesFile() {
  return path.resolve(
    expandRemotePath(
      process.env.DIVEEOI_REMOTE_PROFILES_FILE ?? path.join(remoteConfigDirectory(), "remote-profiles.json"),
    ),
  )
}

export function remoteSecretKeyFile() {
  return path.resolve(
    expandRemotePath(
      process.env.DIVEEOI_REMOTE_SECRET_KEY_FILE ?? path.join(remoteConfigDirectory(), "remote-profiles.key"),
    ),
  )
}
