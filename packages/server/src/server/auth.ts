export * as ServerAuth from "./auth"

import { ConfigService } from "@/effect/config-service"
import { Flag } from "@diveeoi/db/flag/flag"
import { Config as EffectConfig, Context, Option, Redacted } from "effect"
import type { AuthMode } from "@diveeoi/api/auth"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

const password = EffectConfig.all({
  diveeoi: EffectConfig.string("DIVEEOI_SERVER_PASSWORD").pipe(EffectConfig.option),
  legacy: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
}).pipe(
  EffectConfig.map(({ diveeoi, legacy }) =>
    Option.isSome(diveeoi)
      ? diveeoi
      : Option.isSome(legacy)
        ? legacy
        : process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
          ? Option.some("divee")
          : Option.none(),
  ),
)

const username = EffectConfig.all({
  diveeoi: EffectConfig.string("DIVEEOI_SERVER_USERNAME").pipe(EffectConfig.option),
  legacy: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.option),
}).pipe(EffectConfig.map(({ diveeoi, legacy }) => Option.getOrElse(diveeoi, () => Option.getOrElse(legacy, () => "DIVEEOI"))))

const mode = EffectConfig.string("DIVEEOI_AUTH_MODE").pipe(
  EffectConfig.map((value): AuthMode =>
    value === "basic" || value === "jwt" || value === "disabled" ? value : "both",
  ),
  EffectConfig.withDefault("both"),
)

export class Config extends ConfigService.Service<Config>()("@opencode/ServerAuthConfig", {
  password,
  username,
  mode,
}) {}

export type Info = Context.Service.Shape<typeof Config>

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
    Flag.OPENCODE_SERVER_PASSWORD ??
    (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test" ? "divee" : undefined)
  if (!password) return undefined

  const username =
    credentials?.username ??
    process.env["DIVEEOI_SERVER_USERNAME"] ??
    Flag.OPENCODE_SERVER_USERNAME ??
    "DIVEEOI"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
