// Test worker: same protocol as embed/worker.entry.ts, deterministic bag-of-words vectors (no model).
const scope: any = globalThis
const hashEmbed = (text: string) => {
  const v = new Float32Array(1024)
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261
    for (const ch of w) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
    v[Math.abs(h) % 1024] += 1
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map((x) => x / n)
}
scope.onmessage = (event: { data: any }) => {
  const msg = event.data
  if (msg.kind === "init") scope.postMessage({ kind: "ready" })
  else if (msg.kind === "embed") {
    const vectors = msg.texts.map(hashEmbed)
    scope.postMessage({ kind: "embedded", batchId: msg.batchId, vectors, pid: Math.random() }, vectors.map((v: Float32Array) => v.buffer))
  }
}
