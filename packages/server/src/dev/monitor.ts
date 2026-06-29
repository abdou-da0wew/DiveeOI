export class DevMonitor {
  static #interval: ReturnType<typeof setInterval> | null = null

  static start() {
    if (process.env["NODE_ENV"] !== "development") return

    const log = (...args: unknown[]) => {
      const ts = new Date().toISOString().slice(11, 23)
      process.stderr.write(`[${ts}] [DevMonitor] ${args.join(" ")}\n`)
    }

    const check = () => {
      const mem = process.memoryUsage()
      const rssMB = (mem.rss / 1024 / 1024).toFixed(1)
      const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1)
      log(`RSS ${rssMB} MB | heap ${heapMB} MB | uptime ${Math.floor(process.uptime())}s`)
    }

    check()
    this.#interval = setInterval(check, 60_000)
    this.#interval.unref()

    log("DevMonitor started (60s interval)")
  }
}
