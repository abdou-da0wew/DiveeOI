import { Config } from "@/config/config"
import { ConfigV1 } from "@diveeoi/db/v1/config/config"
import { Provider } from "@/provider/provider"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Schema } from "effect"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/config"

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("get", root, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigV1.Info, "Get config info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.get",
            summary: "Get configuration",
            description: "Retrieve the current OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.patch("update", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigV1.Info,
          success: described(ConfigV1.Info, "Successfully updated config"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.update",
            summary: "Update configuration",
            description: "Update OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ConfigProvidersResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
        HttpApiEndpoint.get("composerKeyStatus", `${root}/composer-key`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ configured: Schema.Boolean }), "Artificial Analysis key status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.composerKeyStatus",
            summary: "Get Artificial Analysis key status",
            description: "Returns whether a key is configured without exposing the key or ciphertext.",
          }),
        ),
        HttpApiEndpoint.post("setComposerKey", `${root}/composer-key`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ apiKey: Schema.String }),
          success: described(Schema.Struct({ configured: Schema.Boolean }), "Artificial Analysis key saved"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.setComposerKey",
            summary: "Set Artificial Analysis key",
            description: "Encrypts and stores the Artificial Analysis API key on the server.",
          }),
        ),
        HttpApiEndpoint.delete("removeComposerKey", `${root}/composer-key`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ configured: Schema.Boolean }), "Artificial Analysis key removed"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.removeComposerKey",
            summary: "Remove Artificial Analysis key",
            description: "Removes the encrypted Artificial Analysis API key stored on the server.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
