export * as ServerAuth from "./auth"

import { Config as EffectConfig, Context, Effect, Layer, Option, Redacted } from "effect"

export type AuthMode = "basic" | "jwt" | "both" | "disabled"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
  readonly mode: AuthMode
}

const modeConfig = EffectConfig.string("DIVEEOI_AUTH_MODE").pipe(
  EffectConfig.map((value): AuthMode =>
    value === "basic" || value === "jwt" || value === "disabled" ? value : "both",
  ),
  EffectConfig.withDefault("both"),
)

const authConfig = EffectConfig.all({
  diveeoiPassword: EffectConfig.string("DIVEEOI_SERVER_PASSWORD").pipe(EffectConfig.option),
  legacyPassword: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
  diveeoiUsername: EffectConfig.string("DIVEEOI_SERVER_USERNAME").pipe(EffectConfig.option),
  legacyUsername: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.option),
  mode: modeConfig,
})

export class Config extends Context.Service<Config, Info>()("@opencode/ServerAuthConfig") {
  static layer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get defaultLayer() {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        const config = yield* authConfig
        return Config.of({
          password: Option.isSome(config.diveeoiPassword)
            ? config.diveeoiPassword
            : Option.isSome(config.legacyPassword)
              ? config.legacyPassword
              : process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
                ? Option.some("divee")
                : Option.none(),
          username: Option.getOrElse(config.diveeoiUsername, () => Option.getOrElse(config.legacyUsername, () => "DIVEEOI")),
          mode: config.mode,
        })
      }),
    )
  }
}

/** Authentication is enforced unless explicitly disabled, even with no Basic secret. */
export function required(config: Info) {
  return config.mode !== "disabled"
}

export function basicEnabled(config: Info) {
  return (config.mode === "basic" || config.mode === "both") && Option.isSome(config.password) && config.password.value !== ""
}

export function jwtEnabled(config: Info) {
  return config.mode === "jwt" || config.mode === "both"
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  return (
    basicEnabled(config) &&
    Option.isSome(config.password) &&
    credentials.username === config.username &&
    Redacted.value(credentials.password) === config.password.value
  )
}

export function header(credentials?: Credentials) {
  const password =
    credentials?.password ??
    process.env["DIVEEOI_SERVER_PASSWORD"] ??
    process.env["OPENCODE_SERVER_PASSWORD"] ??
    (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test" ? "divee" : undefined)
  if (!password) return undefined

  const username =
    credentials?.username ?? process.env["DIVEEOI_SERVER_USERNAME"] ?? process.env["OPENCODE_SERVER_USERNAME"] ?? "DIVEEOI"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
