#!/usr/bin/env bun
import os from "os"
import path from "path"

const args = process.argv.slice(2)
const noBinary = args.includes("--no-binary") || process.env.DIVEEOI_BUILD_NOBINARY

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
const env = {
  ...process.env,
  DIVEEOI_LOW_MEM: lowMem ? "1" : "",
  DIVEEOI_BUILD_NOBINARY: skipBinary ? "1" : "",
  DIVEEOI_BUILD_SINGLE: !isRelease ? "1" : "",
}

console.log(`[build] available: ${availableMB}MB, concurrency: ${concurrency}, lowmem: ${lowMem}, nobin: ${skipBinary}`)

const turboArgs = [
  "turbo",
  "build",
  `--concurrency=${concurrency}`,
  ...args.filter((a) => a !== "--no-binary"),
]

const rootDir = path.resolve(import.meta.dir, "..")
const proc = Bun.spawn(turboArgs, {
  env,
  stdio: ["inherit", "inherit", "inherit"],
  cwd: rootDir,
})

const exitCode = await proc.exited
process.exit(exitCode)
