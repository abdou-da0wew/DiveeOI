import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@diveeoi/db/global"

// Keep the cipher text and its master key in separate private XDG locations. The opaque
// filenames avoid advertising the credential in routine data-directory listings; permissions
// and AES-GCM provide the actual protection.
const dataDirectory = path.join(Global.Path.data, ".runtime")
const keyDirectory = path.join(Global.Path.config, ".state")
const masterKeyPath = path.join(keyDirectory, "runtime.bin")
const encryptedKeyPath = path.join(dataDirectory, ".catalog")
const CIPHER = "aes-256-gcm"

async function masterKey() {
  await fs.mkdir(keyDirectory, { recursive: true, mode: 0o700 })
  await fs.chmod(keyDirectory, 0o700)
  try {
    const existing = await fs.readFile(masterKeyPath)
    if (existing.length !== 32) throw new Error("Composer secret master key has an invalid length")
    await fs.chmod(masterKeyPath, 0o600)
    return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const key = randomBytes(32)
    try {
      await fs.writeFile(masterKeyPath, key, { flag: "wx", mode: 0o600 })
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError
      return masterKey()
    }
    return key
  }
}

export async function saveApiKey(value: string) {
  const apiKey = value.trim()
  if (apiKey.length < 16 || apiKey.length > 512) throw new Error("The Artificial Analysis API key looks invalid")
  const key = await masterKey()
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  await fs.chmod(dataDirectory, 0o700)
  const iv = randomBytes(12)
  const cipher = createCipheriv(CIPHER, key, iv)
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()])
  const payload = `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`
  const temporaryPath = `${encryptedKeyPath}.${randomBytes(6).toString("hex")}.tmp`
  try {
    await fs.writeFile(temporaryPath, payload, { flag: "wx", mode: 0o600 })
    await fs.rename(temporaryPath, encryptedKeyPath)
    await fs.chmod(encryptedKeyPath, 0o600)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function readApiKey(envName = "ARTIFICIAL_ANALYSIS_API_KEY") {
  const fromEnvironment = process.env[envName]?.trim()
  try {
    const payload = await fs.readFile(encryptedKeyPath, "utf8")
    const [version, ivText, tagText, encryptedText] = payload.trim().split(".")
    if (version !== "v1" || !ivText || !tagText || !encryptedText) {
      throw new Error("Stored Artificial Analysis key is malformed")
    }
    const decipher = createDecipheriv(CIPHER, await masterKey(), Buffer.from(ivText, "base64url"))
    decipher.setAuthTag(Buffer.from(tagText, "base64url"))
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fromEnvironment || undefined
    if (fromEnvironment) return fromEnvironment
    throw error
  }
}

export async function hasApiKey(envName = "ARTIFICIAL_ANALYSIS_API_KEY") {
  if (process.env[envName]?.trim()) return true
  try {
    await Promise.all([fs.access(encryptedKeyPath), fs.access(masterKeyPath)])
    return true
  } catch {
    return false
  }
}

export async function removeApiKey() {
  await fs.rm(encryptedKeyPath, { force: true })
}

export * as ComposerSecrets from "./composer-secrets"
