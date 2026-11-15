import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "@diveeoi/db/global"

let cachedKey: { directory: string; value: Promise<Buffer> } | undefined

async function loadKey(directory = Global.Path.data) {
  const configured = process.env.DIVEEOI_EXAM_ENCRYPTION_KEY
  if (configured) {
    const key = /^[a-f0-9]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64")
    if (key.length !== 32) {
      throw new Error("DIVEEOI_EXAM_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex or base64")
    }
    return key
  }

  const filename = path.join(directory, "exam-answer-key.bin")
  await mkdir(directory, { recursive: true })
  try {
    const existing = await readFile(filename)
    if (existing.length !== 32)
      throw new Error("Stored exam encryption key is corrupt; restore it from a protected backup")
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
    if (raced.length !== 32) throw new Error("Stored exam encryption key is corrupt")
    return raced
  }
}

function key(directory = Global.Path.data) {
  if (!cachedKey || cachedKey.directory !== directory) {
    cachedKey = { directory, value: loadKey(directory) }
  }
  return cachedKey.value
}

export type EncryptedSecret = { ciphertext: string; iv: string; authTag: string }

export async function encryptExamSecret(value: unknown, dataDirectory = Global.Path.data): Promise<EncryptedSecret> {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", await key(dataDirectory), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()])
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  }
}

export async function decryptExamSecret<T>(secret: EncryptedSecret, dataDirectory = Global.Path.data): Promise<T> {
  const decipher = createDecipheriv("aes-256-gcm", await key(dataDirectory), Buffer.from(secret.iv, "base64"))
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
  return JSON.parse(plaintext) as T
}

export const resetExamEncryptionKeyCacheForTests = () => {
  cachedKey = undefined
}
