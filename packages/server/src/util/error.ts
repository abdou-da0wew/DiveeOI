export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function errorData(err: unknown): { message: string } {
  return { message: errorMessage(err) }
}
