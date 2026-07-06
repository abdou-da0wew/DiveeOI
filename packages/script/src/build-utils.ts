import os from "os"

export async function getAvailableMemoryMB(): Promise<number> {
  if (process.platform === "linux") {
    try {
      const meminfo = await Bun.file("/proc/meminfo").text()
      const match = meminfo.match(/MemAvailable:\s+(\d+)/)
      if (match) return Math.round(parseInt(match[1]) / 1024)
    } catch {
      // fall through
    }
  }
  if (process.platform === "darwin") {
    try {
      const output = await Bun.spawn(["vm_stat"]).stdout
        .pipeTo(new Response())
        .then((r) => r.text())
      const free = parseInt(output.match(/free:\s+(\d+)/)?.[1] ?? "0") * 16384
      return Math.round(free / 1024 / 1024)
    } catch {
      // fall through
    }
  }
  return Math.round((os.totalmem() / 1024 / 1024) * 0.25)
}

export function recommendedConcurrency(availableMB: number): number {
  if (availableMB < 512) return 1
  if (availableMB < 1024) return 1
  if (availableMB < 1536) return 2
  if (availableMB < 3072) return 2
  return 4
}

export function shouldBuildSourcemaps(availableMB: number): boolean {
  return availableMB >= 1536
}

export function shouldBuildBinary(availableMB: number): boolean {
  return availableMB >= 1024
}

export function isLowMemoryEnvironment(availableMB: number): boolean {
  return availableMB < 1536
}
