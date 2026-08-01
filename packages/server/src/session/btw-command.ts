const BTW_RE = /^\/btw\s+(.+)/im

export interface BtwCommand {
  raw: string
  message: string
  formatted: string
}

export type BtwParseResult =
  | { found: true; command: BtwCommand }
  | { found: false }

export function parse(text: string): BtwParseResult {
  const match = text.match(BTW_RE)
  if (!match) return { found: false }

  const message = match[1].trim()
  if (!message) return { found: false }

  const raw = match[0].trim()
  return {
    found: true,
    command: {
      raw,
      message,
      formatted: `<btw-message>${message}</btw-message>`,
    },
  }
}

export function formatForSystem(command: BtwCommand): string {
  return `<btw-message>${command.message}</btw-message>
<instruction>This is a mid-conversation side-channel message from the user. Do NOT start a new task. Acknowledge briefly and continue the current task with updated understanding.</instruction>`
}

export function formatResponse(command: BtwCommand): string {
  return `Noted: ${command.message}`
}

export * as BtwCommand from "./btw-command"
