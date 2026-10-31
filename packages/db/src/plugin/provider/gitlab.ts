import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect } from "effect"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const GitLabPlugin = PluginV2.define({
  id: PluginV2.ID.make("gitlab"),
  effect: Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service

    const accountToken = Effect.fnUntraced(function* () {
      const connection = yield* integrations.connection.forIntegration(Integration.ID.make("gitlab"))
      if (!connection || connection.type !== "credential") return undefined
      const value = (yield* credentials.get(connection.id))?.value
      if (!value) return undefined
      if (value.type === "key") return value.key
      return value.access
    })

    return {
      "catalog.transform": Effect.fn(function* (evt) {
        const item = evt.provider.get(ProviderV2.ID.gitlab)
        if (!item) return
        const token = yield* accountToken()
        if (!token) return
        if (typeof item.provider.request.body.apiKey === "string" && item.provider.request.body.apiKey !== "") return
        evt.provider.update(item.provider.id, (provider) => {
          provider.request.body.apiKey = token
        })
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "gitlab-ai-provider") return
        const mod = yield* Effect.promise(() => import("gitlab-ai-provider"))
        evt.sdk = mod.createGitLab({
          ...evt.options,
          instanceUrl:
            typeof evt.options.instanceUrl === "string"
              ? evt.options.instanceUrl
              : (process.env.GITLAB_INSTANCE_URL ?? "https://gitlab.com"),
          apiKey: typeof evt.options.apiKey === "string" ? evt.options.apiKey : process.env.GITLAB_TOKEN,
          aiGatewayHeaders: {
            "User-Agent": `opencode/${InstallationVersion} gitlab-ai-provider/${mod.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
            "anthropic-beta": "context-1m-2025-08-07",
            ...evt.options.aiGatewayHeaders,
          },
          featureFlags: {
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
            ...evt.options.featureFlags,
          },
        })
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.gitlab) return
        const featureFlags =
          typeof evt.options.featureFlags === "object" && evt.options.featureFlags ? evt.options.featureFlags : {}
        if (evt.model.api.id.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider")).pipe(Effect.orDie)
          const workflowRef =
            typeof evt.model.request.body.workflowRef === "string" ? evt.model.request.body.workflowRef : undefined
          const workflowDefinition =
            typeof evt.model.request.body.workflowDefinition === "string"
              ? evt.model.request.body.workflowDefinition
              : undefined
          const language = evt.sdk.workflowChat(
            gitlab.isWorkflowModel(evt.model.api.id) ? evt.model.api.id : "duo-workflow",
            {
              featureFlags,
              workflowDefinition,
            },
          )
          if (workflowRef) language.selectedModelRef = workflowRef
          evt.language = language
          return
        }
        evt.language = evt.sdk.agenticChat(evt.model.api.id, {
          aiGatewayHeaders: evt.options.aiGatewayHeaders,
          featureFlags,
        })
      }),
    }
  }),
})
