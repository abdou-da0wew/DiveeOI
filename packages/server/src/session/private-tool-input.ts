const PRIVATE_INPUT_TOOLS = new Set(["create_exam"])

export function isPrivateToolInput(tool: string) {
  return PRIVATE_INPUT_TOOLS.has(tool)
}

export function redactToolInput(tool: string, input: Record<string, unknown>) {
  if (!isPrivateToolInput(tool)) return input
  const safe = { ...input }
  if ("answerKey" in safe) safe.answerKey = "[REDACTED]"
  if ("grading" in safe) safe.grading = "[REDACTED]"
  return safe
}
