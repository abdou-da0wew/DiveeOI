import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { sshKeyDirectory } from "./remote-paths"

export interface SSHKeyInfo {
  name: string
  path: string
  publicKeyPath: string
  publicKey: string
  type: string
  comment: string
}

export async function listSSHKeys(): Promise<SSHKeyInfo[]> {
  const directory = sshKeyDirectory()
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }

  const result: SSHKeyInfo[] = []
  for (const name of names.filter((item) => item.endsWith(".pub")).sort()) {
    const publicKeyPath = path.join(directory, name)
    const privatePath = publicKeyPath.slice(0, -4)
    try {
      const [publicKey, privateInfo] = await Promise.all([readFile(publicKeyPath, "utf8"), stat(privatePath)])
      if (!privateInfo.isFile()) continue
      const fields = publicKey.trim().split(/\s+/)
      if (fields.length < 2) continue
      result.push({
        name: name.slice(0, -4),
        path: privatePath,
        publicKeyPath,
        publicKey: publicKey.trim(),
        type: fields[0]!,
        comment: fields.slice(2).join(" "),
      })
    } catch {
      // Ignore non-key files and public keys without a matching private key.
    }
  }
  return result
}

export async function generateSSHKey(nameInput: string) {
  const name = nameInput.trim()
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
    throw new Error("Key name must contain 1-64 letters, numbers, dots, underscores or hyphens")
  }

  const directory = sshKeyDirectory()
  const privatePath = path.join(directory, name)
  const publicKeyPath = privatePath + ".pub"
  await mkdir(directory, { recursive: true, mode: 0o700 })

  try {
    await readFile(privatePath)
    throw new Error("A key with that name already exists")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const ssh2 = await import("ssh2")
  const pair = ssh2.utils.generateKeyPairSync("ed25519", {
    comment: "diveeoi@" + os.hostname(),
  })
  const temporaryPrivate = privatePath + "." + process.pid + ".tmp"
  const temporaryPublic = publicKeyPath + "." + process.pid + ".tmp"

  try {
    await writeFile(temporaryPrivate, pair.private, { flag: "wx", mode: 0o600 })
    await writeFile(temporaryPublic, pair.public + "\n", { flag: "wx", mode: 0o644 })
    await chmod(temporaryPrivate, 0o600)
    await chmod(temporaryPublic, 0o644)
    await rename(temporaryPublic, publicKeyPath)
    await rename(temporaryPrivate, privatePath)
    return {
      name,
      path: privatePath,
      publicKeyPath,
      publicKey: pair.public,
    }
  } catch (error) {
    const fs = await import("node:fs/promises")
    await Promise.all([
      fs.rm(temporaryPrivate, { force: true }),
      fs.rm(temporaryPublic, { force: true }),
      fs.rm(privatePath, { force: true }),
      fs.rm(publicKeyPath, { force: true }),
    ])
    throw error
  }
}
