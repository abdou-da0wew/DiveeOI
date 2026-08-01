import { test, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import * as Scope from "effect/Scope"
import { HttpServer } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process"
import { FSUtil } from "@diveeoi/db/fs-util"
import { CrossSpawnSpawner } from "@diveeoi/db/cross-spawn-spawner"
import { Flag } from "@diveeoi/db/flag/flag"
import { createOpencodeClient } from "@diveeoi/sdk/v2"

import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"

import { TestLLMServer } from "../lib/llm-server"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"
import { ProviderV2 } from "@diveeoi/db/provider"
import { ModelV2 } from "@diveeoi/db/model"
import { Database } from "@diveeoi/db/database/database"
import { httpApiLayer } from "./httpapi-layer"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const testLayer = Layer.mergeAll(
  FSUtil.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
  Database.defaultLayer,
  httpApiLayer,
)

import * as TestConsole from "effect/testing/TestConsole"
const liveEnv = TestConsole.layer

type ServerPath = "raw" | "http"

function client(serverPath: ServerPath, directory?: string, input?: { password?: string; username?: string; headers?: Record<string, string>; workspaceID?: string; onRequest?: (request: Request) => void }) {
  return serverFetch(serverPath, input).pipe(
    Effect.map((fetch) =>
      createOpencodeClient({
        baseUrl: "http://localhost",
        directory,
        experimental_workspaceID: input?.workspaceID,
        headers: input?.headers,
        fetch,
      }),
    ),
  )
}

function serverFetch(serverPath: ServerPath, input?: { password?: string; username?: string; onRequest?: (request: Request) => void }) {
  return HttpServer.HttpServer.use((server) =>
    Effect.sync(() => {
      void serverPath
      Flag.OPENCODE_SERVER_PASSWORD = input?.password
      Flag.OPENCODE_SERVER_USERNAME = input?.username
      const baseUrl = HttpServer.formatAddress(server.address)
      return Object.assign(
        async (request: RequestInfo | URL, init?: RequestInit) => {
          const source = request instanceof Request ? request : new Request(request, init)
          input?.onRequest?.(source)
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

function firstEvent<A>(subscribe: (signal: AbortSignal) => Promise<{ response: Response; data: A }>) {
  return Effect.promise(async () => {
    const ac = new AbortController()
    const result = await subscribe(ac.signal)
    ac.abort()
    return result.data
  })
}

test("repro-build", async () => {
  try {
    const liveLayer = Layer.provideMerge(testLayer, liveEnv)
    await Effect.gen(function* () {
      console.log("Step 1: Layer built, getting SDK...")
      const fetch_ = yield* client("raw")
      console.log("Step 2: Got SDK client, making health request...")
      
      // Catches any errors to show exact location
      try {
        const health = yield* call(() => fetch_.global.health())
        console.log("Health status:", health.response.status)
        expect(health.response.status).toBe(200)
      } catch (e: any) {
        console.error("Health call failed:", e.message)
        throw e
      }
    }).pipe(
      Effect.scoped,
      Effect.provide(liveLayer),
      Effect.runPromise,
    )
  } catch (e: any) {
    console.error("TEST FAILED:", e.message)
    if (e.stack) console.error(e.stack)
    throw e
  }
})
