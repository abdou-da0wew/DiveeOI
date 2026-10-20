import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@diveeoi/db/models-dev"
import { Provider } from "@/provider/provider"
import { Composer } from "@/provider/composer"

import { gzipSync } from "node:zlib"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"
import { ProviderV2 } from "@diveeoi/db/provider"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service

    // The catalog half of `list` is pure data derived from the models.dev
    // snapshot plus the enabled/disabled filters. The heavy projection is
    // shared through `Provider.catalogFor`; here we only apply the filters and
    // memoise the filtered view.
    let catalogCache:
      | {
          all: Record<string, ModelsDev.Provider>
          enabled: string
          disabled: string
          providers: Record<string, Provider.Info>
          public: Record<string, Provider.Info>
        }
      | undefined

    const catalogFor = (all: Record<string, ModelsDev.Provider>, enabledProviders?: ReadonlyArray<string>, disabledProviders?: ReadonlyArray<string>) => {
      const shared = Provider.catalogFor(all)
      const enabledKey = enabledProviders ? enabledProviders.join(",") : ""
      const disabledKey = (disabledProviders ?? []).join(",")
      if (
        catalogCache &&
        catalogCache.all === all &&
        catalogCache.enabled === enabledKey &&
        catalogCache.disabled === disabledKey
      ) {
        return catalogCache
      }

      const disabled = new Set(disabledProviders ?? [])
      const enabled = enabledProviders ? new Set(enabledProviders) : undefined
      const keep = (key: string) => (enabled ? enabled.has(key) : true) && !disabled.has(key)
      const providers: Record<string, Provider.Info> = {}
      const publicProviders: Record<string, Provider.Info> = {}
      for (const key of Object.keys(shared.catalog)) {
        if (!keep(key)) continue
        providers[key] = shared.catalog[key]
        publicProviders[key] = shared.database[key]
      }

      catalogCache = { all, enabled: enabledKey, disabled: disabledKey, providers, public: publicProviders }
      return catalogCache
    }

    const buildList = (
      catalog: NonNullable<typeof catalogCache>,
      connected: Record<string, Provider.Info>,
    ) => {
      const providers = { ...catalog.providers, ...connected }
      const publicProviders: Record<string, Provider.Info> = {}
      // Divee leads the list everywhere: it is the default model, the app's headline entry,
      // and every model list sorts its groups by this order.
      const composer = connected[Composer.PROVIDER_ID]
      if (composer) publicProviders[Composer.PROVIDER_ID] = Provider.toPublicInfo(composer)
      for (const [key, value] of Object.entries(catalog.public)) publicProviders[key] = value
      for (const [key, value] of Object.entries(connected)) {
        if (key === Composer.PROVIDER_ID) continue
        publicProviders[key] = Provider.toPublicInfo(value)
      }

      return {
        all: Object.values(publicProviders),
        default: Provider.defaultModelIDs(providers),
        connected: Object.keys(connected),
      }
    }

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const catalog = catalogFor(all, config.enabled_providers, config.disabled_providers)
      return buildList(catalog, yield* provider.list())
    })

    // This response carries the whole models.dev catalog (~7MB of JSON), and
    // HttpApi re-serializes it (plus the compression middleware re-gzips it
    // synchronously) on every call. Cache the encoded forms against the
    // catalog and connected-provider identities and serve them as-is.
    let encodedCache:
      | {
          catalog: unknown
          connected: unknown
          json: Uint8Array
          gzip: Uint8Array
        }
      | undefined

    const listRaw = Effect.fn("ProviderHttpApi.listRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const catalog = catalogFor(all, config.enabled_providers, config.disabled_providers)
      const connected = yield* provider.list()

      if (!encodedCache || encodedCache.catalog !== catalog || encodedCache.connected !== connected) {
        const json = new TextEncoder().encode(JSON.stringify(buildList(catalog, connected)))
        encodedCache = { catalog, connected, json, gzip: new Uint8Array(gzipSync(json)) }
      }

      const acceptsGzip = (ctx.request.headers["accept-encoding"] ?? "").toLowerCase().includes("gzip")
      return HttpServerResponse.raw(acceptsGzip ? encodedCache.gzip : encodedCache.json, {
        headers: acceptsGzip
          ? { "content-type": "application/json", "content-encoding": "gzip", vary: "Accept-Encoding" }
          : { "content-type": "application/json", vary: "Accept-Encoding" },
      })
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      return true
    })

    return handlers
      .handleRaw("list", listRaw)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
)
