// packages/db/src/mail/mail.ts
// No-op mail service - completely disabled, zero resource consumption

import { Config, Context, Effect, Layer } from "effect"

export interface Interface {
  readonly sendVerificationEmail: (to: string, token: string) => Effect.Effect<void>
  readonly sendEmail: (to: string, subject: string, html: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/MailService") {}

export const layer = Layer.succeed(Service, Service.of({
  sendVerificationEmail: (_to: string, _token: string) => Effect.void,
  sendEmail: (_to: string, _subject: string, _html: string) => Effect.void,
}))

export const defaultLayer = layer

export const sendVerificationEmail = (_to: string, _token: string) => Effect.void

export const sendEmail = (_to: string, _subject: string, _html: string) => Effect.void