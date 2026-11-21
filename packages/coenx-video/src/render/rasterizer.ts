import { constants } from "node:fs"
import { access } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export interface ImageMagickResolutionOptions {
  packageRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  environment?: NodeJS.ProcessEnv
}

export interface ImageMagickRuntime {
  binary: string
  env: NodeJS.ProcessEnv
  bundled: boolean
}

async function isExecutable(file: string, platform: NodeJS.Platform) {
  try {
    await access(file, platform === "win32" ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function resolveImageMagickRuntime(
  options: ImageMagickResolutionOptions = {},
): Promise<ImageMagickRuntime> {
  const environment = options.environment ?? process.env
  const explicit = environment.COENX_VIDEO_MAGICK?.trim()
  if (explicit) return { binary: explicit, env: environment, bundled: false }

  const root = options.packageRoot ?? PACKAGE_ROOT
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const directory = path.join(root, "vendor", "imagemagick", `${platform}-${arch}`)
  const executable = platform === "win32" ? "magick.exe" : "magick"
  const candidates = [path.join(directory, "bin", executable), path.join(directory, executable)]

  for (const binary of candidates) {
    if (!(await isExecutable(binary, platform))) continue
    const env = { ...environment }
    const configurePath = path.join(directory, "etc", "ImageMagick-7")
    try {
      await access(configurePath, constants.R_OK)
      env.MAGICK_CONFIGURE_PATH = configurePath
      env.MAGICK_HOME = directory
    } catch {
      // A single-file portable install can still use its compiled-in defaults.
    }
    return { binary, env, bundled: true }
  }

  return { binary: "magick", env: environment, bundled: false }
}

export async function resolveImageMagickBinary(options: ImageMagickResolutionOptions = {}) {
  return (await resolveImageMagickRuntime(options)).binary
}
