import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import DESCRIPTION from "./http-request.txt"

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to request (must be http or https)" }),
  method: Schema.optional(Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const)).annotate({
    description: "HTTP method (default GET)",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Request headers as a flat object",
  }),
  body: Schema.optional(Schema.String).annotate({
    description: "Request body (string). Only meaningful for POST/PUT/PATCH.",
  }),
  timeoutMs: Schema.optional(Schema.Number).annotate({
    description: "Request timeout in milliseconds (default 15000)",
  }),
})

const DEFAULT_ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1",
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
]

function isAllowlisted(host: string): boolean {
  return DEFAULT_ALLOWED_HOSTS.some((pat) =>
    typeof pat === "string" ? pat === host : pat.test(host),
  )
}

interface HttpRequestMetadata {
  url: string
  method: string
  status?: number
  allowlisted: boolean
  available: boolean
  reason: string
  error?: string
}

export const HttpRequestTool = Tool.define(
  "http_request",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: {
          url: string
          method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
          headers?: Record<string, string>
          body?: string
          timeoutMs?: number
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const method = params.method ?? "GET"
          let parsedUrl: URL
          try {
            parsedUrl = new URL(params.url)
          } catch (err) {
            const meta: HttpRequestMetadata = {
              url: params.url,
              method,
              allowlisted: false,
              available: false,
              reason: "invalid-url",
              error: (err as Error).message,
            }
            return {
              output: `Invalid URL: ${(err as Error).message}`,
              title: "http_request (invalid URL)",
              metadata: meta,
            }
          }
          if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            const meta: HttpRequestMetadata = {
              url: params.url,
              method,
              allowlisted: false,
              available: false,
              reason: "bad-protocol",
              error: `Unsupported protocol: ${parsedUrl.protocol}`,
            }
            return {
              output: `Unsupported protocol: ${parsedUrl.protocol}`,
              title: "http_request (bad protocol)",
              metadata: meta,
            }
          }
          const allowlisted = isAllowlisted(parsedUrl.hostname)
          if (!allowlisted) {
            yield* ctx.ask({
              permission: "http_request",
              patterns: [parsedUrl.host],
              always: [],
              metadata: { url: params.url, method, host: parsedUrl.host },
            })
          }
          const timeoutMs = params.timeoutMs ?? 15000
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          // Try the fetch; on failure, build a failure-meta return.
          const fetched = yield* Effect.tryPromise(() =>
            fetch(params.url, {
              method,
              headers: params.headers ?? {},
              body: params.body,
              signal: controller.signal,
            }),
          ).pipe(
            Effect.map((response) => ({ ok: true as const, response })),
            Effect.catch((err) => Effect.succeed({ ok: false as const, err: err as Error })),
          )
          clearTimeout(timer)
          if (!fetched.ok) {
            const meta: HttpRequestMetadata = {
              url: params.url,
              method,
              allowlisted,
              available: true,
              reason: fetched.err.name,
              error: fetched.err.message,
            }
            return {
              output: `Request failed: ${fetched.err.message}`,
              title: `http_request (failed: ${fetched.err.name})`,
              metadata: meta,
            }
          }
          const response = fetched.response
          const text = yield* Effect.tryPromise(() => response.text()).pipe(
            Effect.catch((err) => Effect.succeed(`(body read failed: ${(err as Error).message})`)),
          )
          const MAX = 64 * 1024
          const truncated = text.length > MAX
          const meta: HttpRequestMetadata = {
            url: params.url,
            method,
            status: response.status,
            allowlisted,
            available: true,
            reason: "",
          }
          return {
            output: JSON.stringify(
              {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: truncated ? text.slice(0, MAX) + "\n... (truncated)" : text,
                truncated,
              },
              null,
              2,
            ),
            title: `${method} ${parsedUrl.host} → ${response.status}`,
            metadata: meta,
          }
        }),
    }
  }),
)
