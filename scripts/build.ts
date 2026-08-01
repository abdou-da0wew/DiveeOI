#!/usr/bin/env bun
import os from "os"
import path from "path"
import { BuildSoundSystem } from "./build-sounds"

const args = process.argv.slice(2)
const noBinary = args.includes("--no-binary") || process.env.DIVEEOI_BUILD_NOBINARY

// --- platform arg parsing ---
// --current / --this : build only for current platform
// --all              : build for all platforms
// --platform <os-arch> : build for specific platform (e.g. linux-x64, darwin-arm64)
const hasCurrent = args.includes("--current") || args.includes("--this")
const hasAll = args.includes("--all")

function parsePlatform(args: string[]): { platform: string | null; extra: string[] } {
  const result: string[] = []
  let platform: string | null = null
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--platform") {
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        platform = args[++i]
        continue
      }
    } else if (a.startsWith("--platform=")) {
      platform = a.slice("--platform=".length)
      continue
    } else if (["--no-binary", "--current", "--this", "--all"].includes(a)) {
      continue
    }
    result.push(a)
  }
  return { platform, extra: result }
}

const parsed = parsePlatform(args)
const platform = parsed.platform
const extraArgs = parsed.extra

// --- memory detection ---
let availableMB = 0
if (process.platform === "linux") {
  try {
    const meminfo = await Bun.file("/proc/meminfo").text()
    const match = meminfo.match(/MemAvailable:\s+(\d+)/)
    if (match) availableMB = Math.round(parseInt(match[1]) / 1024)
  } catch {}
}
if (!availableMB) {
  availableMB = Math.round((os.totalmem() / 1024 / 1024) * 0.25)
}

// --- compute settings ---
let concurrency: number
if (availableMB < 512) concurrency = 1
else if (availableMB < 1024) concurrency = 1
else if (availableMB < 1536) concurrency = 2
else if (availableMB < 3072) concurrency = 2
else concurrency = 4

const lowMem = availableMB < 1536
const skipBinary = noBinary || availableMB < 1024

const isRelease = process.env.DIVEEOI_RELEASE === "1"
const buildSingle = hasCurrent || (!hasAll && !isRelease)

const env = {
  ...process.env,
  DIVEEOI_LOW_MEM: lowMem ? "1" : "",
  DIVEEOI_BUILD_NOBINARY: skipBinary ? "1" : "",
  DIVEEOI_BUILD_SINGLE: buildSingle ? "1" : "",
}
if (platform) {
  const parts = platform.split("-")
  if (parts.length >= 2) {
    const targetOs = parts[0] === "windows" ? "win32" : parts[0]
    const targetArch = parts[1]
    env.DIVEEOI_BUILD_OS = targetOs
    env.DIVEEOI_BUILD_ARCH = targetArch
  } else {
    console.error(`[build] invalid --platform "${platform}". Use format like "linux-x64", "darwin-arm64", "windows-x64"`)
    process.exit(1)
  }
}

console.log(
  `[build] available: ${availableMB}MB, concurrency: ${concurrency}, lowmem: ${lowMem}, nobin: ${skipBinary}` +
    (buildSingle ? ", single" : ", all") +
    (platform ? `, platform=${platform}` : ""),
)

// --- sounds ---
const sound = new BuildSoundSystem()

const turboArgs = [
  "turbo",
  "build",
  `--concurrency=${concurrency}`,
  ...extraArgs,
]

const rootDir = path.resolve(import.meta.dir, "..")

sound.startMusic("chirp.ogg")

const proc = Bun.spawn(turboArgs, {
  env,
  stdio: ["inherit", "inherit", "inherit"],
  cwd: rootDir,
})

const exitCode = await proc.exited

sound.stopMusic()
sound.dispose()

if (exitCode === 0) {
  sound.playEffect("challenge_complete.ogg")
} else {
  sound.playEffect("hurt.ogg")
}

process.exit(exitCode)
