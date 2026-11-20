import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function loadSSHHostKey(filename: string) {
  const ssh2 = await import("ssh2")
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })

  try {
    const current = await readFile(filename, "utf8")
    if (!(ssh2.utils.parseKey(current) instanceof Error)) {
      await chmod(filename, 0o600)
      return current
    }
    await rename(filename, filename + ".legacy-" + Date.now() + ".bak")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const generated = ssh2.utils.generateKeyPairSync("ed25519", {
    comment: "diveeoi@" + os.hostname(),
  })
  const temporary = filename + "." + process.pid + ".tmp"
  await writeFile(temporary, generated.private, { flag: "wx", mode: 0o600 })
  try {
    await chmod(temporary, 0o600)
    await rename(temporary, filename)
    await chmod(filename, 0o600)
    return generated.private
  } catch (error) {
    const fs = await import("node:fs/promises")
    await fs.rm(temporary, { force: true })
    throw error
  }
}
