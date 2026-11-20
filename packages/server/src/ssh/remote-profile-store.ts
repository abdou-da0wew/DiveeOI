import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { decryptRemoteSecret, encryptRemoteSecret, type EncryptedSecret } from "./remote-secret"
import { expandRemotePath, remoteProfilesFile } from "./remote-paths"
import type { RemoteProfile, RemoteProfileInput, RemoteSessionReference, ResolvedRemoteProfile } from "./remote-types"

interface StoredProfile extends RemoteProfile {
  secret?: EncryptedSecret
}

interface ProfileFile {
  version: 1
  profiles: StoredProfile[]
}

async function readProfiles(): Promise<ProfileFile> {
  let value: ProfileFile
  try {
    value = JSON.parse(await readFile(remoteProfilesFile(), "utf8")) as ProfileFile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, profiles: [] }
    }
    throw error
  }

  if (value.version !== 1 || !Array.isArray(value.profiles)) {
    throw new Error("Remote profiles file has an unsupported format")
  }
  return value
}

async function writeProfiles(file: ProfileFile) {
  const filename = remoteProfilesFile()
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, filename)
  await chmod(filename, 0o600)
}

function publicProfile(profile: StoredProfile): RemoteProfile {
  const { secret: _secret, ...visible } = profile
  return visible
}

function profileID(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function validateInput(input: RemoteProfileInput) {
  const name = input.name.trim()
  const host = input.host.trim().replace(/^\[|\]$/g, "")
  const user = input.user.trim()
  const port = input.port ?? 22

  if (!name) throw new Error("Profile name is required")
  if (!host || /[\s\u0000-\u001f]/.test(host)) {
    throw new Error("Enter a valid SSH host or address")
  }
  if (!user || /[\s\u0000-\u001f]/.test(user)) {
    throw new Error("Enter a valid SSH username")
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SSH port must be between 1 and 65535")
  }
  if (!["password", "privateKey", "agent"].includes(input.authMethod)) {
    throw new Error("Unsupported SSH authentication method")
  }

  return {
    name,
    host,
    user,
    port,
    workingDirectory: input.workingDirectory?.trim() || "~",
  }
}

export async function listRemoteProfiles(): Promise<RemoteProfile[]> {
  const file = await readProfiles()
  return file.profiles.map(publicProfile).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveRemoteProfile(input: RemoteProfileInput): Promise<RemoteProfile> {
  const normalized = validateInput(input)
  const file = await readProfiles()
  const id = input.id?.trim() || profileID(normalized.name)
  if (!/^[a-z0-9_-]{1,64}$/.test(id)) throw new Error("Profile ID is invalid")

  const previous = file.profiles.find((profile) => profile.id === id)
  let secret = previous?.secret
  let keyPath: string | undefined

  if (input.authMethod === "password") {
    if (previous?.authMethod !== "password") secret = undefined
    if (input.password) secret = await encryptRemoteSecret({ password: input.password })
    if (!secret) throw new Error("A password is required for this profile")
  } else if (input.authMethod === "privateKey") {
    if (!input.keyPath?.trim()) throw new Error("Select a private key file")
    keyPath = path.resolve(expandRemotePath(input.keyPath.trim()))
    try {
      if (!(await readFile(keyPath)).length) throw new Error("Private key is empty")
    } catch {
      throw new Error("The selected private key file could not be read")
    }
    if (input.passphrase) {
      secret = await encryptRemoteSecret({ passphrase: input.passphrase })
    } else if (previous?.authMethod !== "privateKey") {
      secret = undefined
    }
  } else {
    secret = undefined
  }

  const profile: StoredProfile = {
    id,
    ...normalized,
    authMethod: input.authMethod,
    ...(keyPath ? { keyPath } : {}),
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    ...(secret ? { secret } : {}),
  }

  file.profiles = [...file.profiles.filter((item) => item.id !== id), profile]
  await writeProfiles(file)
  return publicProfile(profile)
}

export async function deleteRemoteProfile(id: string): Promise<boolean> {
  const file = await readProfiles()
  const profiles = file.profiles.filter((profile) => profile.id !== id)
  if (profiles.length === file.profiles.length) return false
  file.profiles = profiles
  await writeProfiles(file)
  return true
}

export async function resolveRemoteProfile(
  reference: RemoteSessionReference,
): Promise<ResolvedRemoteProfile | undefined> {
  const file = await readProfiles()
  const profile = file.profiles.find((item) => item.id === reference.profileId)
  if (!profile) return undefined

  let secret: { password?: string; passphrase?: string } = {}
  if (profile.secret) secret = await decryptRemoteSecret(profile.secret)

  const workingDirectory = reference.workingDirectory?.trim() || profile.workingDirectory || "~"
  const base = publicProfile(profile)

  switch (profile.authMethod) {
    case "password":
      if (!secret.password) {
        throw new Error(`SSH password is not available for profile "${profile.name}"`)
      }
      return { ...base, workingDirectory, auth: { kind: "password", password: secret.password } }
    case "privateKey":
      if (!profile.keyPath) throw new Error("The profile has no private key path")
      return {
        ...base,
        workingDirectory,
        auth: {
          kind: "privateKey",
          keyPath: profile.keyPath,
          ...(secret.passphrase ? { passphrase: secret.passphrase } : {}),
        },
      }
    case "agent":
      return {
        ...base,
        workingDirectory,
        auth: { kind: "agent", socketPath: process.env.SSH_AUTH_SOCK },
      }
  }
}
