// Test worker that loads fine but dies on the first batch.
const scope: any = globalThis
scope.onmessage = (event: { data: any }) => {
  if (event.data.kind === "init") scope.postMessage({ kind: "ready" })
  else if (event.data.kind === "embed") scope.postMessage({ kind: "error", batchId: event.data.batchId, message: "boom" })
}
