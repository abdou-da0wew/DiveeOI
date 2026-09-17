# @diveeoi/llm

Schema-first LLM core. Provides the provider-agnostic message/tool/request model, the `LLMEvent` stream, the `HttpClient` route pipeline, and the provider facades that wrap it. No session, plugin, or permission code.

## Model

All runtime shapes are `Effect.Schema.Class` in `src/schema/`:

- `ids.ts` — branded `ProviderID/ModelID/VariantID`, `ProviderMetadata`.
- `options.ts` — `GenerationOptions`, `Limits`, `Model { id, providerID, route }`, `CachePolicy`.
- `messages.ts` — `TextPart/SystemPart/ToolCallPart/ToolResultPart/Message { system/user/assistant/tool }`, `ToolDefinition`, `LLMRequest`.
- `events.ts` — `Usage`, `LLMEvent { text-start/delta/end, reasoning-*/tool-input-delta/tool-call/tool-result/tool-error/provider-error/step-start/finish/ finish }`, `PreparedRequest`, `LLMResponse`.
- `errors.ts` — `LLMError`, `ToolFailure`.

Convenience constructors live on the type (`Message.system(...)`, `Message.user(...)`, `ToolCallPart.make(...)`, `Model.make(...)`, `GenerationOptions.make(...)`). The top-level `LLM` namespace is reserved for request helpers: `LLM.request`, `LLM.generate`, `LLM.stream`, `LLM.updateRequest`, `LLM.generateObject`.

## Routes

A route composes four orthogonal pieces via `Route.make({ id, provider, protocol, endpoint, auth, framing })`:

- **`Protocol`** (`src/route/protocol.ts`) — provider contract: `body.from(request)`, `body.schema`, `stream.event` (decoded framed bytes), `stream.step(state, event)` state machine that emits common `LLMEvent`s. Example `OpenAIChat.protocol`, `AnthropicMessages.protocol`, `BedrockConverse.protocol`.
- **`Endpoint`** (`src/route/endpoint.ts`) — `{ baseURL, path, query }` owned by the route. `Endpoint.path("/chat/completions", {baseURL})` or `Endpoint.path(({body})=>`/model/${body.modelId}/...`)` for templated paths.
- **`Auth`** (`src/route/auth.ts`) — `Auth.bearer(apiKey)` vs `Auth.header("x-api-key", key)` vs `Auth.passthrough` or a per-request signer (`Auth(a => signed Headers + body)`). Routes that need SigV4 (Bedrock) implement `Auth` as a signing function.
- **`Framing`** (`src/route/framing.ts`) — bytes -> frames (`Framing.sse` vs Bedrock's `Framing<object>` event-stream).

Transports further specialize `Framing`: `HttpTransport.httpJson` (POST + SSE) vs `WebSocketTransport.jsonTransport` (IO template with `prepare` building a WebSocket URL and `frames` decoding text). One protocol to many provider deployments is the point: `OpenAIChat.protocol` powers OpenAI + DeepSeek + TogetherAI + Cerebras + Baseten + Fireworks + DeepInfra each as a 5-15 line `Route.make`.

## Protocols and providers

- Implementations: `src/protocols/{openai-chat,openai-responses,anthropic-messages,gemini,bedrock-converse,openai-compatible-chat,shared,utils/*}`.
- Facades: `src/providers/{openai,anthropic,google,azure,amazon-bedrock,cloudflare,github-copilot,gateway,openrouter,xai,openai-compatible}` + `openai-compatible-profile.ts` (family defaults).

Protocol file order: model input, request body schema, streaming event schema, parser state, `fromRequest`, event handlers, `Protocol + route`. Prefer small `utils/*` helpers for media/cache/tool-stream quirks so two protocol files compare side-by-side.

Facade rule: configure the route before `.model(id)` — the model holds only `id/providerID/route`:

```ts
const openai = OpenAI.configure({ apiKey, baseURL })
const responses = openai.responses("gpt-4o-mini")
const azure = Azure.configure({ resourceName, apiKey, apiVersion: "v1" })
const dep = azure.responses("my-deployment")
```

`AtLeastOne<T>` enforces required-derivation pairs (e.g. Azure `resourceName|baseURL`), and `ProviderAuthOption` enforces `apiKey xor auth`.

## Client

Entry for callers (see `src/route/client.ts`):

```ts
const request = LLM.request({
  model: OpenAI.configure({ apiKey }).responses("gpt-4o-mini"),
  system: "You are concise.",
  prompt: "Say hello.",
})

const response = yield* LLMClient.generate(request)     // events collected into LLMResponse
const stream  = LLMClient.stream(request)               // Stream<LLMEvent>
const prep    = yield* LLMClient.prepare<OpenAIChatBody>(request) // compile without sending
events.filter(LLMEvent.is.toolCall)
```

Callers add tools via `Tool.toDefinitions(tools)` on `request.tools`. One-call execution is `ToolRuntime.dispatch(tools, toolCall)`:

```ts
const get_weather = tool({
  description: "Get current weather",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ temperature: Schema.Number, condition: Schema.String }),
  execute: ({city}) => Effect.gen(function*(){ /* ... */ })
})
const t = { get_weather }
const events = yield* LLM.stream(LLM.updateRequest(request, { tools: Tool.toDefinitions(t) })).pipe(Stream.runCollect)
const call = events.find(LLMEvent.is.toolCall)
if (call && !call.providerExecuted) {
  const dispatched = yield* ToolRuntime.dispatch(t, call)
}
```

Provider-defined/hosted tools (`web_search`, `code_execution` etc.) surface as `tool-call providerExecuted:true` + `tool-result providerExecuted:true` — skip local dispatch when `providerExecuted` is set.

Chronological `Message.system(...)` inside `messages` is lowered per-route: only `claude-opus-4-8` preserves it natively; elsewhere it is wrapped as `<system-update>...</system-update>` inside ordinary user text.

## Layout

```
src/
  llm.ts                      # request constructors
  schema/                     # canonical Schema model
  route/{client,executor,protocol,endpoint,auth,auth-options,framing,transport/{http,websocket}}
  protocols/{shared,openai-chat,openai-responses,anthropic-messages,gemini,bedrock-converse,bedrock-event-stream,openai-compatible-chat,utils/*}
  providers/{openai,anthropic,...}
  tool.ts / tool-runtime.ts / provider.ts / cache-policy.ts / provider-error.ts
test/lib/{effect,http}       # testEffect, record/replay helpers
```

Dependency arrow points down; protocols don't import providers.

## Test

```bash
bun --cwd packages/llm run typecheck
bun --cwd packages/llm run test   # fixture-first recorded tests; RECORD=1 requires api keys
RECORDED_PROVIDER=openai RECORDED_PREFIX=openai-chat bun test  # filtered replay/record
```
