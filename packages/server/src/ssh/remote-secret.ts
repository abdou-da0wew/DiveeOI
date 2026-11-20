import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { remoteSecretKeyFile } from "./remote-paths"

interface EncryptedSecret {
  iv: string
  ciphertext: string
  tag: string
}

async function encryptionKey() {
  const configured = process.env.DIVEEOI_REMOTE_SECRET_KEY
  if (configured) {
    const value = /^[a-f0-9]{64}$/i.test(configured)
      ? Buffer.from(configured, "hex")
      : Buffer.from(configured, "base64")
    if (value.length !== 32) {
      throw new Error("DIVEEOI_REMOTE_SECRET_KEY must be 32 bytes encoded as hex or base64")
    }
    return value
  }

  const filename = remoteSecretKeyFile()
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })

  try {
    const existing = await readFile(filename)
    if (existing.length !== 32) throw new Error("Remote profile encryption key is corrupt")
    await chmod(filename, 0o600).catch(() => undefined)
    return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const generated = randomBytes(32)
  try {
    await writeFile(filename, generated, { flag: "wx", mode: 0o600 })
    await chmod(filename, 0o600)
    return generated
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const raced = await readFile(filename)
    if (raced.length !== 32) throw new Error("Remote profile encryption key is corrupt")
    return raced
  }
}

export async function encryptRemoteSecret(value: unknown): Promise<EncryptedSecret> {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()])
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  }
}

export async function decryptRemoteSecret<T>(value: EncryptedSecret): Promise<T> {
  const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(), Buffer.from(value.iv, "base64"))
  decipher.setAuthTag(Buffer.from(value.tag, "base64"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
  return JSON.parse(plaintext) as T
}

export type { EncryptedSecret }
