import { Global } from "@diveeoi/db/global"
import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const themesDir = path.join(Global.Path.config, "themes")

export const themeRoute = HttpRouter.use((router) =>
  router.add("GET", "/_opencode/themes", () =>
    Effect.gen(function* () {
      const entries = yield* Effect.promise(() => readdir(themesDir, { withFileTypes: true }).catch(() => []))
      const result: Record<string, unknown> = {}
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue
        const id = entry.name.slice(0, -5)
        const content = yield* Effect.promise(() =>
          readFile(path.join(themesDir, entry.name), "utf8").then(
            (text) => {
              try {
                result[id] = JSON.parse(text)
              } catch {}
            },
            () => {},
          ),
        )
      }
      return HttpServerResponse.jsonUnsafe(result)
    }),
  ),
)
