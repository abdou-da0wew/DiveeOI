import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    // Only commands that open a real database (push/studio/pull) use this; `generate`
    // does not. Match the runtime resolution (database.ts) instead of a developer-
    // machine absolute path: OPENCODE_DB first, otherwise the default data dir name.
    url: process.env.OPENCODE_DB ?? "opencode.db",
  },
})
