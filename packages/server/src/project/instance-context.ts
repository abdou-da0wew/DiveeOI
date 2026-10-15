import { LocalContext } from "@/util/local-context"
import { FSUtil } from "@diveeoi/db/fs-util"
import type * as Project from "./project"
import type { RemoteConfig } from "@/ssh-client"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
  /**
   * Remote session config (draft-10). When present, the session's file/shell/
   * env operations are redirected to the remote SSH server. `directory` and
   * `worktree` hold the REMOTE paths (POSIX). The local context is still
   * accessible via the `ctx_local` tool-call override.
   */
  readonly remote?: RemoteConfig
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory OR ctx.worktree.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (FSUtil.contains(ctx.directory, filepath)) return true
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.worktree === "/") return false
  return FSUtil.contains(ctx.worktree, filepath)
}

/** True when the context is remote (SSH session). */
export function isRemote(ctx: InstanceContext): boolean {
  return ctx.remote !== undefined
}

/** Format the remote host for display: `user@host:port`. */
export function remoteLabel(ctx: InstanceContext): string | undefined {
  if (!ctx.remote) return undefined
  return `${ctx.remote.user}@${ctx.remote.host}:${ctx.remote.port}`
}
