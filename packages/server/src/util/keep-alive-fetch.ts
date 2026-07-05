// Bun's built-in fetch handles keep-alive natively — no agent needed.
// This file exists purely as a typed re-export for API compatibility.
export const keepAliveFetch: {
  (input: URL | RequestInfo, init?: RequestInit): Promise<Response>
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
} = globalThis.fetch
