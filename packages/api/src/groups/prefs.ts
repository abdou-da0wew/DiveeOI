import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

const PrefValue = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
})

const PrefScope = Schema.String.pipe(Schema.brand("PrefScope"))

export const PrefsGroup = HttpApiGroup.make("server.prefs")
  .add(
    HttpApiEndpoint.get("prefs.list", "/api/prefs/:scope", {
      params: { scope: PrefScope },
      success: Schema.Struct({
        data: Schema.Array(PrefValue),
      }).annotate({ identifier: "PrefsListResponse" }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.prefs.list",
        summary: "List preferences for a scope",
        description: "Returns all preferences for the given scope.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("prefs.set", "/api/prefs/:scope", {
      params: { scope: PrefScope },
      payload: Schema.Struct({
        name: Schema.String,
        value: Schema.String,
      }),
      success: Schema.Struct({
        data: PrefValue,
      }).annotate({ identifier: "PrefsSetResponse" }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.prefs.set",
        summary: "Set a preference",
        description: "Upsert a preference value for the given scope.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("prefs.delete", "/api/prefs/:scope/:name", {
      params: {
        scope: PrefScope,
        name: Schema.String,
      },
      success: Schema.Void,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.prefs.delete",
        summary: "Delete a preference",
        description: "Delete a single preference by scope and name.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("prefs.deleteScope", "/api/prefs/:scope", {
      params: { scope: PrefScope },
      success: Schema.Void,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.prefs.deleteScope",
        summary: "Delete all preferences for a scope",
        description: "Delete every preference under the given scope.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "preferences",
      description: "Server-backed preference storage with scoped key-value pairs.",
    }),
  )
