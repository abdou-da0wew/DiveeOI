export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  // Not every thrown value is an `Error`. Bun's native WebSocket (which shadows the `ws`
  // package) rejects with a DOM `ErrorEvent`, whose `message` is a prototype getter rather than
  // an own property - so JSON.stringify yields `{"isTrusted":true}` and the real reason is lost.
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === "string") return message
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function errorData(err: unknown): { message: string } {
  return { message: errorMessage(err) }
}
