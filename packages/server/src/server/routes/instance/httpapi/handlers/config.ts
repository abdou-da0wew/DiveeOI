import { Config } from "@/config/config"
import { ComposerSecrets } from "@/provider/composer-secrets"
import { ArtificialAnalysis } from "@/provider/artificial-analysis"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const composerKeyStatus = Effect.fn("ConfigHttpApi.composerKeyStatus")(function* () {
      const current = yield* configSvc.get()
      const envName =
        current.performance?.composer?.artificial_analysis_api_key_env?.trim() || "ARTIFICIAL_ANALYSIS_API_KEY"
      return { configured: yield* Effect.promise(() => ComposerSecrets.hasApiKey(envName)) }
    })

    const setComposerKey = Effect.fn("ConfigHttpApi.setComposerKey")(function* (ctx) {
      yield* Effect.promise(() => ComposerSecrets.saveApiKey(ctx.payload.apiKey))
      ArtificialAnalysis.reset()
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return { configured: true }
    })

    const removeComposerKey = Effect.fn("ConfigHttpApi.removeComposerKey")(function* () {
      yield* Effect.promise(() => ComposerSecrets.removeApiKey())
      ArtificialAnalysis.reset()
      yield* markInstanceForDisposal(yield* InstanceState.context)
      const current = yield* configSvc.get()
      const envName =
        current.performance?.composer?.artificial_analysis_api_key_env?.trim() || "ARTIFICIAL_ANALYSIS_API_KEY"
      return { configured: yield* Effect.promise(() => ComposerSecrets.hasApiKey(envName)) }
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("providers", providers)
      .handle("composerKeyStatus", composerKeyStatus)
      .handle("setComposerKey", setComposerKey)
      .handle("removeComposerKey", removeComposerKey)
  }),
)
