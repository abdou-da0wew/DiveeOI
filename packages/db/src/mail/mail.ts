export * as MailService from "./mail"

import { Config, Context, Effect, Layer } from "effect"

export interface Interface {
  readonly sendVerificationEmail: (to: string, token: string) => Effect.Effect<void>
  readonly sendEmail: (to: string, subject: string, html: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/MailService") {}

export class MailConfig extends Context.Service<MailConfig, {
  host: string
  port: number
  user: string
  pass: string
  from: string
  appUrl: string
}>()("@diveeoi/MailConfig") {}

function createTransporter(config: { host: string; port: number; user: string; pass: string }) {
  const nodemailer = require("nodemailer")
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  })
}

function buildVerificationHtml(appUrl: string, token: string): string {
  const link = `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 24px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 8px; padding: 32px;">
    <h1 style="font-size: 20px; margin: 0 0 16px; color: #333;">Verify your DiveeOI account</h1>
    <p style="color: #555; line-height: 1.5; margin: 0 0 24px;">Click the button below to verify your email address and activate your account.</p>
    <a href="${link}" style="display: inline-block; background: #0066ff; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">Verify Email</a>
    <p style="color: #999; font-size: 12px; margin-top: 24px;">If you did not create an account, you can ignore this email.</p>
  </div>
</body>
</html>`
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* MailConfig
    const appUrl = config.appUrl
    const hasSmtpCreds = config.user.length > 0 && config.pass.length > 0

    let transporter: any = null
    if (hasSmtpCreds) {
      transporter = createTransporter(config)
    } else {
      console.warn("[mail] SMTP not configured — emails will be logged to console only")
    }

    const svc: Interface = {
      sendEmail: (to: string, subject: string, html: string) =>
        Effect.gen(function* () {
          if (!transporter) {
            console.log(`[mail] TO: ${to}`)
            console.log(`[mail] SUBJECT: ${subject}`)
            console.log(`[mail] BODY:\n${html}`)
            return
          }
          yield* Effect.tryPromise({
            try: () => transporter.sendMail({ from: config.from, to, subject, html }),
            catch: (err) => new Error(`Failed to send email: ${String(err)}`),
          }).pipe(Effect.orDie)
        }),

      sendVerificationEmail: (to: string, token: string) =>
        Effect.gen(function* () {
          const html = buildVerificationHtml(appUrl, token)
          yield* svc.sendEmail(to, "Verify your DiveeOI account", html)
        }),
    }
    return Service.of(svc)
  }),
)

export const mailConfigLayer = Layer.effect(
  MailConfig,
  Effect.gen(function* () {
    return {
      host: yield* Config.string("DIVEEOI_SMTP_HOST").pipe(Config.withDefault("smtp.gmail.com")),
      port: yield* Config.string("DIVEEOI_SMTP_PORT").pipe(Config.withDefault("587")).pipe(Config.map(Number)),
      user: yield* Config.string("DIVEEOI_SMTP_USER").pipe(Config.withDefault("")),
      pass: yield* Config.string("DIVEEOI_SMTP_PASS").pipe(Config.withDefault("")),
      from: yield* Config.string("DIVEEOI_SMTP_FROM").pipe(Config.withDefault("DiveeOI <noreply@diveeoi.local>")),
      appUrl: yield* Config.string("DIVEEOI_APP_URL").pipe(Config.withDefault("http://localhost:4097")),
    }
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(mailConfigLayer))

// Also export for easier use
export const sendVerificationEmail = (to: string, token: string) =>
  Effect.gen(function* () {
    const mail = yield* Service
    yield* mail.sendVerificationEmail(to, token)
  })

export const sendEmail = (to: string, subject: string, html: string) =>
  Effect.gen(function* () {
    const mail = yield* Service
    yield* mail.sendEmail(to, subject, html)
  })
