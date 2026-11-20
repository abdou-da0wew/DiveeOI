import { Effect } from "effect"
import { createConnection } from "../src/ssh-client/connection"
import { makeSftpFs } from "../src/ssh-client/sftp-fs"
import type { RemoteConfig } from "../src/ssh-client/types"

const home = process.env.HOME
const socketPath = process.env.SSH_AUTH_SOCK
const host = process.env.DIVEEOI_SSH_E2E_HOST ?? "127.0.0.1"
const port = Number(process.env.DIVEEOI_SSH_E2E_PORT ?? 22)
const user = process.env.DIVEEOI_SSH_E2E_USER ?? process.env.USER
const workingDirectory = process.env.DIVEEOI_SSH_E2E_WORKING_DIRECTORY ?? home
const keyPath = process.env.DIVEEOI_SSH_E2E_KEY

if (!home || !user || !workingDirectory || (!keyPath && !socketPath)) {
  throw new Error("Set HOME, DIVEEOI_SSH_E2E_USER, and either DIVEEOI_SSH_E2E_KEY or SSH_AUTH_SOCK")
}

const auth: RemoteConfig["auth"] = keyPath
  ? {
      kind: "privateKey",
      keyPath,
      passphrase: process.env.DIVEEOI_SSH_E2E_KEY_PASSPHRASE,
    }
  : { kind: "agent", socketPath }

const config: RemoteConfig = {
  host,
  port,
  user,
  auth,
  workingDirectory,
  identity: "diveeoi-ssh-smoke-a",
}
const secondConfig: RemoteConfig = {
  ...config,
  identity: "diveeoi-local-ssh-e2e-b",
  workingDirectory: "/tmp",
}

const connection = await createConnection(config)
let secondConnection: Awaited<ReturnType<typeof createConnection>> | undefined
const testDirectory = `/tmp/diveeoi-remote-session-e2e-${process.pid}`
try {
  const shell = await Effect.runPromise(connection.exec("printf 'remote-shell-ok'; pwd", { cwd: home }))
  if (shell.exitCode !== 0 || !shell.stdout.includes("remote-shell-ok")) {
    throw new Error(`SSH shell execution failed: ${shell.stderr}`)
  }

  const sftp = await Effect.runPromise(connection.sftp())
  const fs = makeSftpFs(sftp, "linux", home)
  const injectionMarker = `${testDirectory}/unexpected-command-execution`
  const specialDirectory = `${testDirectory}/cwd '$(touch ${injectionMarker})`
  await Effect.runPromise(fs.ensureDir(specialDirectory))
  const specialCwd = await Effect.runPromise(connection.exec("pwd", { cwd: specialDirectory }))
  const markerCreated = await Effect.runPromise(fs.exists(injectionMarker))
  if (specialCwd.stdout.trim() !== specialDirectory || markerCreated) {
    throw new Error("Remote working-directory shell quoting failed")
  }

  const filePath = `${testDirectory}/nested/hello.txt`
  await Effect.runPromise(fs.writeWithDirs(filePath, "first version", 0o600))
  const initial = await Effect.runPromise(fs.readFileString(filePath))
  if (initial !== "first version") throw new Error("SFTP read after write failed")

  await Effect.runPromise(fs.writeWithDirs(filePath, "edited version", 0o600))
  const edited = await Effect.runPromise(fs.readFileString(filePath))
  if (edited !== "edited version") throw new Error("SFTP edit failed")

  const glob = await Effect.runPromise(fs.glob("**/*.txt", { cwd: testDirectory, absolute: true }))
  if (!glob.includes(filePath)) throw new Error(`SFTP glob failed: ${JSON.stringify(glob)}`)

  const upward = await Effect.runPromise(fs.findUp("hello.txt", `${testDirectory}/nested`))
  if (!upward.includes(filePath)) throw new Error(`SFTP findUp failed: ${JSON.stringify(upward)}`)

  const renamedPath = `${testDirectory}/nested/renamed.txt`
  await Effect.runPromise(fs.rename(filePath, renamedPath))
  const renamedContent = await Effect.runPromise(fs.readFileString(renamedPath))
  if (renamedContent !== "edited version") throw new Error("SFTP rename/read failed")

  secondConnection = await createConnection(secondConfig)
  const firstPwd = await Effect.runPromise(connection.exec("pwd", { cwd: home }))
  const secondPwd = await Effect.runPromise(secondConnection.exec("pwd", { cwd: "/tmp" }))
  if (firstPwd.stdout.trim() !== home || secondPwd.stdout.trim() !== "/tmp") {
    throw new Error("Remote session working-directory isolation failed")
  }

  console.log("PASS SSH auth + shell execution")
  console.log("PASS SFTP recursive create + read + edit + rename")
  console.log("PASS SFTP glob + upward discovery")
  console.log("PASS independent remote session working directories")
} finally {
  await Effect.runPromise(
    connection
      .exec(`rm -rf -- '${testDirectory.replace(/'/g, "'\\''")}'`, { cwd: "/tmp" })
      .pipe(Effect.catch(() => Effect.succeed(undefined))),
  )
  if (secondConnection) {
    await Effect.runPromise(secondConnection.close().pipe(Effect.catch(() => Effect.void)))
  }
  await Effect.runPromise(connection.close().pipe(Effect.catch(() => Effect.void)))
}
