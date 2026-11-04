import type { Component } from "solid-js"
import { Icon } from "@diveeoi/ui/icon"

export type TargetedLearningStatus = "complete" | "failed" | "pending" | "running" | "skipped"

export const formatSetupStepLabel = (name: string) =>
  ({
    probe: "Probe",
    preflight: "Preflight",
    download: "Download",
    verify: "Verify",
    "runtime-check": "Runtime check",
    "golden-self-test": "Golden self-test",
    benchmark: "Benchmark",
    "recommend-profile": "Recommend profile",
  })[name] ?? name.replace(/[-_]+/g, " ").replace(/\\b\\w/g, (letter) => letter.toUpperCase())

const STATUS = {
  complete: {
    label: "Complete",
    icon: "check-small",
    tone: "success",
  },
  failed: {
    label: "Failed",
    icon: "circle-x",
    tone: "danger",
  },
  pending: {
    label: "Pending",
    icon: "warning",
    tone: "warning",
  },
  running: {
    label: "Running",
    icon: "download",
    tone: "info",
  },
  skipped: {
    label: "Not run",
    icon: "dash",
    tone: "muted",
  },
} as const

export const TargetedLearningStatusBadge: Component<{
  status: TargetedLearningStatus
  label?: string
}> = (props) => {
  const state = () => STATUS[props.status]

  return (
    <span
      class={`tl-status-badge tl-status-badge--${state().tone}`}
    >
      <Icon name={state().icon} size="small" />
      <span>{props.label ?? state().label}</span>
    </span>
  )
}
