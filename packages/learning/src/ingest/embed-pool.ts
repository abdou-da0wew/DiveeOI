// packages/learning/src/ingest/embed-pool.ts
//
// Promise-based pool of embedding workers (plan §7.7). N Bun Workers each hold their own copy of
// the model; batches go to whichever worker is idle, so load balances itself. Workers load the
// model concurrently with the main thread parsing the book.

export interface EmbedWorkerInit {
  modelDir: string
  signature: unknown
  options: Record<string, unknown>
}

export interface EmbedWorkerPool {
  readonly size: number
  embed: (texts: string[]) => Promise<Float32Array[]>
  close: () => Promise<void>
}

interface Job {
  texts: string[]
  resolve: (v: Float32Array[]) => void
  reject: (e: Error) => void
}

const DEFAULT_WORKER_URL = new URL("../embed/worker.entry.ts", import.meta.url)

export const createEmbedWorkerPool = (input: {
  size: number
  init: EmbedWorkerInit
  workerUrl?: URL
}): EmbedWorkerPool => {
  const size = Math.max(1, input.size)
  const queue: Job[] = []
  let nextBatch = 1
  let dead = 0
  let closed = false

  interface W {
    worker: Worker
    ready: Promise<void>
    busy: boolean
    alive: boolean
    current?: { batchId: number; job: Job }
  }
  const workers: W[] = []

  const pump = () => {
    for (const w of workers) {
      if (queue.length === 0) return
      if (!w.alive || w.busy) continue
      const job = queue.shift()!
      w.busy = true
      const batchId = nextBatch++
      w.current = { batchId, job }
      w.ready.then(
        () => w.alive && w.worker.postMessage({ kind: "embed", batchId, texts: job.texts }),
        () => undefined,
      )
    }
    if (dead === workers.length && queue.length > 0) {
      for (const job of queue.splice(0)) job.reject(new Error("all embedding workers failed"))
    }
  }

  const kill = (w: W, error: Error) => {
    if (!w.alive) return
    w.alive = false
    dead++
    const current = w.current
    w.current = undefined
    w.busy = false
    try {
      w.worker.terminate()
    } catch {
      // already gone
    }
    if (current) current.job.reject(error)
    pump()
  }

  for (let i = 0; i < size; i++) {
    const worker = new Worker(input.workerUrl ?? DEFAULT_WORKER_URL)
    let markReady!: () => void
    let markFailed!: (e: Error) => void
    const ready = new Promise<void>((res, rej) => {
      markReady = res
      markFailed = rej
    })
    ready.catch(() => undefined)
    const w: W = { worker, ready, busy: false, alive: true }
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg.kind === "ready") {
        markReady()
        pump()
      } else if (msg.kind === "embedded" && w.current && w.current.batchId === msg.batchId) {
        const job = w.current.job
        w.current = undefined
        w.busy = false
        job.resolve(msg.vectors as Float32Array[])
        pump()
      } else if (msg.kind === "error") {
        const error = new Error(msg.message)
        markFailed(error)
        if (w.current && (msg.batchId === undefined || msg.batchId === w.current.batchId)) kill(w, error)
        else if (msg.batchId === undefined) kill(w, error)
      }
    }
    worker.onerror = (event: ErrorEvent) => {
      const error = new Error(event.message || "embedding worker crashed")
      markFailed(error)
      kill(w, error)
    }
    worker.postMessage({ kind: "init", ...input.init })
    workers.push(w)
  }

  return {
    size,
    embed: (texts) =>
      new Promise<Float32Array[]>((resolve, reject) => {
        if (closed) return reject(new Error("pool is closed"))
        queue.push({ texts, resolve, reject })
        pump()
      }),
    close: async () => {
      closed = true
      for (const job of queue.splice(0)) job.reject(new Error("pool closed"))
      for (const w of workers) {
        w.alive = false
        // A batch already on a worker would never answer once the worker is terminated.
        if (w.current) {
          const job = w.current.job
          w.current = undefined
          job.reject(new Error("pool closed"))
        }
        try {
          w.worker.terminate()
        } catch {
          // ignore
        }
      }
    },
  }
}
