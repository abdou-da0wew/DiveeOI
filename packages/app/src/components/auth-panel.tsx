import type { JSX } from "solid-js"
import { Button } from "@diveeoi/ui/button"
import { Logo } from "@diveeoi/ui/logo"

export interface AuthPanelProps {
  title: string
  description: string
  children: JSX.Element
  footer?: JSX.Element
}

/** Shared, theme-aware sign-in/register surface built from DiveeOI UI primitives. */
export function AuthPanel(props: AuthPanelProps) {
  return (
    <main class="relative flex min-h-dvh w-screen items-center justify-center overflow-hidden bg-background-base px-4 py-10 text-text-strong">
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -top-44 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--surface-raised-base-hover),transparent_68%)] opacity-70 blur-3xl" />
        <div class="absolute -bottom-72 -left-40 size-[32rem] rounded-full bg-[radial-gradient(circle,var(--divee-accent),transparent_68%)] opacity-[0.08] blur-3xl" />
      </div>

      <div class="relative z-10 flex w-full max-w-[420px] flex-col items-center">
        <a href="/" aria-label="DiveeOI home" class="rounded-md text-text-strong transition-opacity hover:opacity-80">
          <Logo class="text-[20px] font-medium" />
        </a>

        <section class="mt-8 w-full rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha p-6 shadow-[var(--shadow-lg-border-base)] sm:p-8">
          <header class="mb-6 text-center">
            <h1 class="text-20-medium text-text-strong">{props.title}</h1>
            <p class="mt-2 text-13-regular leading-5 text-text-weak">{props.description}</p>
          </header>

          {props.children}

          {props.footer && (
            <footer class="mt-6 border-t border-border-weaker-base pt-4 text-center text-12-regular text-text-weak">
              {props.footer}
            </footer>
          )}
        </section>

        <p class="mt-6 text-11-regular text-text-weak">Your instance. Your workspace. Your data.</p>
      </div>
    </main>
  )
}

export function AuthSubmitButton(props: { children: JSX.Element; disabled?: boolean }) {
  return (
    <Button type="submit" variant="primary" size="large" class="mt-2 w-full" disabled={props.disabled}>
      {props.children}
    </Button>
  )
}
