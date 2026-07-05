import { createRequire } from "module"

export function resolveContextModeMCP(
  config?: { enabled?: boolean },
): Record<string, { type: "local"; command: string[]; enabled: boolean }> | undefined {
  if (process.env.DIVEEOI_CONTEXT_MODE_DISABLED === "1") return undefined

  if (config?.enabled === false) return undefined

  const _require = createRequire(import.meta.url)
  let entryPoint: string | undefined

  try {
    entryPoint = _require.resolve("context-mode")
  } catch {
    return undefined
  }

  return {
    "context-mode": {
      type: "local" as const,
      command: ["node", entryPoint],
      enabled: true,
    },
  }
}
