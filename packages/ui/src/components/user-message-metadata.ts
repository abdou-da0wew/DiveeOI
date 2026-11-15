export type UserMessageMetadataValue = string | number | boolean

export type UserMessagePresentation = {
  kind: string
  label: string
  summary?: string
  metadata?: Record<string, UserMessageMetadataValue>
}

export type ParsedUserMessage = {
  presentation: UserMessagePresentation
  body: string
}

const MARKER = /\n<!--diveeoi-user-message (\{[^\n]*\})-->$/i
const MAX_LABEL_LENGTH = 80
const MAX_SUMMARY_LENGTH = 180
const MAX_METADATA_ENTRIES = 12

function validPresentation(value: unknown): value is UserMessagePresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (
    typeof input.kind !== "string" ||
    !/^[a-z][a-z0-9-]{0,39}$/.test(input.kind) ||
    typeof input.label !== "string" ||
    !input.label.trim() ||
    input.label.length > MAX_LABEL_LENGTH ||
    (input.summary !== undefined && (typeof input.summary !== "string" || input.summary.length > MAX_SUMMARY_LENGTH))
  )
    return false

  if (input.metadata === undefined) return true
  if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) return false
  const entries = Object.entries(input.metadata as Record<string, unknown>)
  if (entries.length > MAX_METADATA_ENTRIES) return false
  return entries.every(([key, item]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(key)) return false
    if (typeof item === "string") return item.length <= 180
    return typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))
  })
}

/** Append UI-only presentation metadata without changing agent-facing text offsets. */
export function serializeUserMessage(body: string, presentation: UserMessagePresentation): string {
  if (!validPresentation(presentation)) return body
  const json = JSON.stringify({ ...presentation, v: 1 }).replace(/--/g, "\\u002d\\u002d")
  return `${body}\n<!--diveeoi-user-message ${json}-->`
}

/** Parse the optional presentation marker without changing the model-facing body. */
export function parseUserMessage(text: string): ParsedUserMessage | undefined {
  const match = MARKER.exec(text)
  if (!match) return

  try {
    const value = JSON.parse(match[1]) as Record<string, unknown>
    if (value.v !== 1 || !validPresentation(value)) return
    return {
      presentation: {
        kind: value.kind,
        label: value.label,
        ...(value.summary === undefined ? {} : { summary: value.summary }),
        ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
      },
      body: text.slice(0, match.index),
    }
  } catch {
    return
  }
}
