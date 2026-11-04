import type { Component } from "solid-js"
import { Icon } from "@diveeoi/ui/icon"
import { useLanguage } from "@/context/language"

export type TargetedLearningStatus = "complete" | "failed" | "pending" | "running" | "skipped"

export type TFunction = (key: never, params?: never) => string

export const formatSetupStepLabel = (name: string, t?: (key: string) => string) => {
  const key = `targetedLearning.steps.${name}`
  if (t) {
    // t() returns the key itself when the translation is missing — fall back to title-casing.
    const translated = t(key)
    if (translated && translated !== key) return translated
  }
  return (
    ({
      probe: "Probe",
      preflight: "Preflight",
      download: "Download",
      verify: "Verify",
      "runtime-check": "Runtime check",
      "golden-self-test": "Golden self-test",
      benchmark: "Benchmark",
      "recommend-profile": "Recommend profile",
    })[name] ??
    name
      .split(/[-_]+/)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ")
  )
}

const STATUS = {
  complete: {
    key: "targetedLearning.status.complete",
    fallback: "Complete",
    icon: "check-small",
    tone: "success",
  },
  failed: {
    key: "targetedLearning.status.failed",
    fallback: "Failed",
    icon: "circle-x",
    tone: "danger",
  },
  pending: {
    key: "targetedLearning.status.pending",
    fallback: "Pending",
    icon: "warning",
    tone: "warning",
  },
  running: {
    key: "targetedLearning.status.running",
    fallback: "Running",
    icon: "download",
    tone: "info",
  },
  skipped: {
    key: "targetedLearning.status.skipped",
    fallback: "Not run",
    icon: "dash",
    tone: "muted",
  },
} as const

export const TargetedLearningStatusBadge: Component<{
  status: TargetedLearningStatus
  label?: string
}> = (props) => {
  const language = useLanguage()
  const state = () => STATUS[props.status]
  const label = () => {
    if (props.label) return props.label
    const translated = language.t(state().key as never)
    return translated && translated !== state().key ? translated : state().fallback
  }

  return (
    <span class={`tl-status-badge tl-status-badge--${state().tone}`}>
      <Icon name={state().icon} size="small" />
      <span>{label()}</span>
    </span>
  )
}
