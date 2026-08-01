import { test, expect, describe } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import * as Scope from "effect/Scope"
import { HttpServer } from "effect/unstable/http"
import { FSUtil } from "@diveeoi/db/fs-util"
import { CrossSpawnSpawner } from "@diveeoi/db/cross-spawn-spawner"
import { Flag } from "@diveeoi/db/flag/flag"
import { createOpencodeClient } from "@diveeoi/sdk/v2"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Database } from "@diveeoi/db/database/database"
import { httpApiLayer } from "./httpapi-layer"
import { testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  Layer.mergeAll(
    FSUtil.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
    Database.defaultLayer,
    httpApiLayer,
  ),
)

function serverFetch() {
  return HttpServer.HttpServer.use((server) =>
    Effect.sync(() => {
      Flag.OPENCODE_SERVER_PASSWORD = undefined
      Flag.OPENCODE_SERVER_USERNAME = undefined
      const baseUrl = HttpServer.formatAddress(server.address)
      return Object.assign(
        async (request: RequestInfo | URL, init?: RequestInit) => {
          const source = request instanceof Request ? request : new Request(request, init)
          const url = new URL(source.url)
          return globalThis.fetch(new Request(new URL(`${url.pathname}${url.search}`, baseUrl), source))
        },
      )
    }),
  )
}

function call<A>(effect: () => Promise<{ response: Response; data: A }>) {
  return Effect.promise(() => effect().then((r) => r))
}

describe("repro3", () => {
  it.live(
    "first test using testEffect",
    Effect.gen(function* () {
      const fetch_ = yield* serverFetch()
      const sdk = createOpencodeClient({ baseUrl: "http://localhost", fetch: fetch_ })
      
      try {
        const health = yield* call(() => sdk.global.health())
        expect(health.response.status).toBe(200)
      } catch (e: any) {
        console.error("FAILED:", e.message)
        console.error("Stack:", e.stack?.split("\n").slice(0, 10).join("\n"))
        throw e
      }
    }),
  )
})
