import { createHash } from "node:crypto"
import { chmod, mkdtemp, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"

const release = "7.1.2-36"
const packages = {
  "linux-x64": {
    archive: `ImageMagick-${release}-portable-Q8-linux-x64.tar.xz`,
    sha256: "839e8fc986003746764310d0cff16bf608ce66e288f195631436a98a0c2c7372",
  },
  "linux-arm64": {
    archive: `ImageMagick-${release}-portable-Q8-linux-arm64.tar.xz`,
    sha256: "04c1cbea077cd318234e7cd8de2e80b229b2358bf386c2bbc90b43cea07899d0",
  },
} as const

type Target = keyof typeof packages

async function run(command: string[], cwd?: string, env: NodeJS.ProcessEnv = process.env) {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`${command[0]} failed (${exitCode}): ${stderr || stdout}`)
  }
  return { stdout, stderr }
}

function targetFromArgument(): Target {
  const requested = process.argv[2] ?? `${process.platform}-${process.arch}`
  if (requested !== "linux-x64" && requested !== "linux-arm64") {
    throw new Error(`Unsupported ImageMagick vendor target: ${requested}. Supported: linux-x64, linux-arm64.`)
  }
  if (requested !== `${process.platform}-${process.arch}`) {
    throw new Error(
      `Build ${requested} on a matching ${requested} Linux host; cross-architecture verification is not supported.`,
    )
  }
  return requested
}

async function verifyInstall(directory: string) {
  const binary = path.join(directory, "bin", "magick")
  const configurePath = path.join(directory, "etc", "ImageMagick-7")
  const info = await stat(binary)
  if (!info.isFile()) throw new Error("ImageMagick archive does not contain bin/magick")
  await chmod(binary, 0o755)

  const env = {
    ...process.env,
    MAGICK_HOME: directory,
    MAGICK_CONFIGURE_PATH: configurePath,
  }
  const version = await run([binary, "-version"], undefined, env)
  if (!version.stdout.includes(`ImageMagick ${release}`) || !version.stdout.includes(" Q8 ")) {
    throw new Error(`Unexpected bundled ImageMagick version: ${version.stdout.split("\n")[0]}`)
  }
  const delegates = version.stdout.toLowerCase()
  for (const delegate of ["rsvg", "raqm", "pangocairo"]) {
    if (!delegates.includes(delegate)) {
      throw new Error(`Bundled ImageMagick is missing the required ${delegate} delegate`)
    }
  }

  const dependencies = await run(["ldd", binary], undefined, env)
  if (dependencies.stdout.includes("not found")) {
    throw new Error(`Bundled ImageMagick has unresolved shared libraries:\n${dependencies.stdout}`)
  }
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error("The ImageMagick vendor installer currently supports Linux release targets only.")
  }

  const target = targetFromArgument()
  const artifact = packages[target]
  const packageRoot = path.resolve(import.meta.dir, "..")
  const vendorRoot = path.join(packageRoot, "vendor", "imagemagick")
  const destination = process.env.COENX_VIDEO_MAGICK_DESTINATION
    ? path.resolve(process.env.COENX_VIDEO_MAGICK_DESTINATION)
    : path.join(vendorRoot, target)
  const destinationParent = path.dirname(destination)
  await mkdir(destinationParent, { recursive: true })

  const staging = await mkdtemp(path.join(destinationParent, `.install-${target}-`))
  const extracted = path.join(staging, "runtime")
  const archivePath = path.join(staging, artifact.archive)
  const backup = `${destination}.previous-${process.pid}`

  try {
    const localArchive = process.env.COENX_VIDEO_MAGICK_ARCHIVE
    let bytes: Uint8Array
    if (localArchive) {
      bytes = await readFile(path.resolve(localArchive))
    } else {
      const url = `https://github.com/ImageMagick/ImageMagick/releases/download/${release}/${artifact.archive}`
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (!response.ok) throw new Error(`ImageMagick download failed: HTTP ${response.status}`)
      bytes = new Uint8Array(await response.arrayBuffer())
    }
    if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("ImageMagick archive exceeds the 100 MB safety limit")
    const actualHash = createHash("sha256").update(bytes).digest("hex")
    if (actualHash !== artifact.sha256) {
      throw new Error(`ImageMagick SHA-256 mismatch: expected ${artifact.sha256}, received ${actualHash}`)
    }
    await Bun.write(archivePath, bytes)
    await mkdir(extracted, { recursive: true })
    await run(["tar", "-xJf", archivePath, "-C", extracted, "--strip-components=1"])
    await verifyInstall(extracted)

    await rm(backup, { recursive: true, force: true })
    try {
      await rename(destination, backup)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    try {
      await rename(extracted, destination)
      await rm(backup, { recursive: true, force: true })
    } catch (error) {
      try {
        await rename(backup, destination)
      } catch {
        // Keep the original installation untouched when no backup was present.
      }
      throw error
    }

    console.log(`Installed ImageMagick ${release} for ${target} at ${destination}`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

await main()
