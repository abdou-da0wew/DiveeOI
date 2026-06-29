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

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [tailwindcss(), solid()] as any,
  define: {
    "import.meta.env.VITE_DIVEEOI_CHANNEL": JSON.stringify(channel),
    "import.meta.env.VITE_DIVEEOI_SERVER_USERNAME": JSON.stringify(process.env.VITE_DIVEEOI_SERVER_USERNAME ?? process.env.OPENCODE_SERVER_USERNAME ?? ""),
    "import.meta.env.VITE_DIVEEOI_SERVER_PASSWORD": JSON.stringify(process.env.VITE_DIVEEOI_SERVER_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD ?? ""),
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
})
