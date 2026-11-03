import type { EventSessionError } from "@diveeoi/sdk/v2"

type SessionError = EventSessionError["properties"]["error"]

export function sessionNotificationKey(directory: string, sessionID: string) {
  return `${directory}\u0000${sessionID}`
}

export function markFailedSession(failedSessions: Set<string>, directory: string, sessionID: string | undefined) {
  if (!sessionID) return false
  const key = sessionNotificationKey(directory, sessionID)
  if (failedSessions.has(key)) return false
  failedSessions.add(key)
  return true
}

export function markSessionError(
  recentErrors: Map<string, number>,
  directory: string,
  sessionID: string | undefined,
  now: number,
  duplicateWindowMs = 5_000,
) {
  if (!sessionID) return true
  for (const [key, expiresAt] of recentErrors) {
    if (expiresAt <= now) recentErrors.delete(key)
  }
  const key = sessionNotificationKey(directory, sessionID)
  const expiresAt = recentErrors.get(key)
  if (expiresAt !== undefined && expiresAt > now) return false
  recentErrors.set(key, now + duplicateWindowMs)
  return true
}

export function consumeFailedSession(failedSessions: Set<string>, directory: string, sessionID: string | undefined) {
  if (!sessionID) return false
  return failedSessions.delete(sessionNotificationKey(directory, sessionID))
}

export function sessionErrorDescription(
  error: SessionError | undefined,
  sessionTitle: string | undefined,
  fallback: string,
) {
  const rawMessage =
    error?.data && "message" in error.data && typeof error.data.message === "string" ? error.data.message : undefined
  const message = rawMessage?.split(/\r?\n/, 1)[0]?.trim()
  return message || sessionTitle || fallback
}
