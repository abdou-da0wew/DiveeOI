import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import solid from "vite-plugin-solid"
import { fileURLToPath } from "url"

const channel = (() => {
  const raw = process.env.DIVEEOI_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.DIVEEOI_CHANNEL === "latest") return "prod"
  return "dev"
})()

const isLowMem = process.env.DIVEEOI_LOW_MEM === "1"
const serverPort = process.env.VITE_DIVEEOI_SERVER_PORT ?? process.env.DIVEEOI_SERVER_PORT ?? "4097"
const configuredServerUrl = process.env.VITE_DIVEEOI_SERVER_URL ?? process.env.DIVEEOI_SERVER_URL
const configuredServerHost = process.env.VITE_DIVEEOI_SERVER_HOST ?? process.env.DIVEEOI_SERVER_HOST ?? "127.0.0.1"
const serverTarget = (() => {
  if (configuredServerUrl) return configuredServerUrl.replace(/\/$/, "")
  if (/^https?:\/\//i.test(configuredServerHost)) {
    const target = new URL(configuredServerHost)
    if (!target.port) target.port = serverPort
    return target.toString().replace(/\/$/, "")
  }
  return `http://${configuredServerHost}:${serverPort}`
})()
const apiPaths = [
  "api", "global", "session", "project", "provider", "agent", "model", "command", "file", "path", "vcs",
  "pty", "mcp", "lsp", "formatter", "instance", "permission", "question", "event", "workspace", "sync", "tui",
  "experimental", "config", "targeted-learning", "memory", "remote", "_opencode", "doc", "control", "skill", "task",
  "openapi.json",
].join("|")

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [tailwindcss(), solid()] as any,
  define: {
    "import.meta.env.VITE_DIVEEOI_CHANNEL": JSON.stringify(channel),
  },
  server: {
    host: "0.0.0.0",
    // Permit Arena preview hosts and local development without disabling Vite's
    // host-header protection (DNS-rebinding mitigation).
    allowedHosts: [".e2b.app", "localhost", "127.0.0.1", "::1"],
    port: 3000,
    proxy: {
      [`^/(?:${apiPaths})(?:/|$)`]: {
        target: serverTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
    sourcemap: !isLowMem,
    rollupOptions: isLowMem ? {
      maxParallelFileOps: 2,
      cache: false,
    } : undefined,
  },
  worker: {
    format: "es",
  },
})
