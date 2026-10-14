// packages/server/src/tool/shell/elevation.ts
// Privilege elevation module (draft-10 P11).
//
// When the agent legitimately needs a privileged command (systemctl, apt,
// pkill of a root process, Windows service control), the shell tool currently
// dies with permission-denied. This module adds opt-in elevation:
//
//   shell.elevation: "off" | "ask" | "allow" (default "off")
//
// Password sources, checked in order:
//   1. The tool-call param `sudo_password` (MUST be redacted from persisted
//      parts, logs, events, and metadata — strip before updatePart).
//   2. The DiveeOI credential store (shell.sudo_password_credential).
//   3. The OS keyring — `secret-tool lookup diveeoi sudo` (GNOME/libsecret),
//      `security find-generic-password -s diveeoi` (macOS).
//
// Linux/macOS implementation:
//   - Fast path: `sudo -n true` succeeds → OS already has cached credentials
//     → prepend `sudo` normally.
//   - Askpass path: write the password to a 0600 tmpfs file (/dev/shm when
//     available), set SUDO_ASKPASS=<helper> and run `sudo -A -p '' <command>`.
//   - Credential cache: after first successful elevation, hold the password
//     in-process as `Redacted` for a TTL (default 15 min). Within TTL: skip
//     re-reading keyring/params; still validate with `sudo -n true` first.
//
// Windows implementation (sketch — not in this commit, see P11 plan):
//   - Native sudo (Windows 11 24H2+) when `sudo.exe` exists.
//   - Elevated helper: one UAC popup → named-pipe server, ACL'd to local user.
//   - This file declares the interface; the Windows path is TODO.
//
// Off-by-default. Every use is permission-asked or logged.

import { Effect } from "effect"
import * as Duration from "effect/Duration"

export type ElevationMode = "off" | "ask" | "allow"

export interface ElevationConfig {
  mode: ElevationMode
  /** Credential store key for the sudo password (optional). */
  credentialKey?: string
  /** TTL for the in-process password cache, in seconds (default 900 = 15 min). */
  ttlSeconds?: number
}

/** A redacted string — the password value lives in memory but never serializes. */
export class Redacted {
  private constructor(private readonly value: string) {}
  static make(value: string): Redacted {
    return new Redacted(value)
  }
  /** Read the underlying value. Callers must not persist or log the result. */
  reveal(): string {
    return this.value
  }
  toJSON(): string {
    return "<redacted>"
  }
  toString(): string {
    return "<redacted>"
  }
}

/**
 * In-process credential cache. After the first successful elevation, the
 * password is held as `Redacted` for the TTL. Within TTL: skip re-reading
 * keyring/params; still validate with `sudo -n true` first so we never feed
 * a stale password. TTL expiry clears the in-memory value.
 */
export class CredentialCache {
  private cached: Redacted | undefined
  private cachedAt: number | undefined
  private ttlMs: number

  constructor(ttlSeconds: number = 900) {
    this.ttlMs = ttlSeconds * 1000
  }

  /** Store the password; starts the TTL clock. */
  set(password: string): void {
    this.cached = Redacted.make(password)
    this.cachedAt = Date.now()
  }

  /** Read the cached password if TTL has not elapsed; else undefined. */
  get(): Redacted | undefined {
    if (this.cached === undefined || this.cachedAt === undefined) return undefined
    if (Date.now() - this.cachedAt >= this.ttlMs) {
      this.cached = undefined
      this.cachedAt = undefined
      return undefined
    }
    return this.cached
  }

  /** Clear the cache (called on elevation failure or explicit reset). */
  clear(): void {
    this.cached = undefined
    this.cachedAt = undefined
  }
}

/**
 * Fast path: probe whether the OS already has cached sudo credentials.
 * Returns true when `sudo -n true` succeeds — in that case the caller just
 * prepends `sudo` normally with no askpass dance.
 *
 * On Windows, this is a no-op (returns false) — elevation uses the
 * elevated-helper path instead.
 */
export function hasCachedSudo(spawner: {
  spawn: (cmd: unknown) => Effect.Effect<{ exitCode: number }, unknown, unknown>
}): Effect.Effect<boolean> {
  if (process.platform === "win32") return Effect.succeed(false)
  // Run `sudo -n true` — non-interactive, no password prompt. If exit 0,
  // OS already has cached credentials.
  return spawner
    .spawn(["sudo", "-n", "true"] as unknown as never)
    .pipe(
      Effect.map((r) => r.exitCode === 0),
      Effect.catch(() => Effect.succeed(false)),
      Effect.timeout(Duration.seconds(2)),
      Effect.catch(() => Effect.succeed(false)),
    ) as Effect.Effect<boolean>
}

/**
 * Build the SUDO_ASKPASS helper script path. The helper is a 3-line shell
 * script that `cat`s a 0600 tmpfs file containing the password. The file is
 * written to /dev/shm when available (RAM-backed, never hits disk), else
 * to os.tmpdir() with 0600 permissions.
 *
 * The caller is responsible for:
 *   - writing the password file before invoking sudo -A
 *   - deleting the file in a finalizer (finally / Effect.ensuring)
 *   - setting SUDO_ASKPASS=<helperPath> in the spawn env
 */
export function askpassPaths(): { helperPath: string; passwordPath: string } {
  const tmpdir = process.env.TMPDIR || "/tmp"
  const shm = "/dev/shm"
  const base = process.platform === "linux" && canWriteTo(shm) ? shm : tmpdir
  const id = `diveeoi-askpass-${process.pid}-${Date.now()}`
  const passwordPath = `${base}/${id}.pw`
  const helperPath = `${base}/${id}.sh`
  return { helperPath, passwordPath }
}

function canWriteTo(dir: string): boolean {
  try {
    // Synchronous probe — keep the helper side-effect free at module load.
    const fs = require("node:fs") as typeof import("node:fs")
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The askpass helper script content. Writes the password to stdout when
 * invoked by sudo. The script itself does not contain the password — it
 * reads from the password file.
 */
export function askpassScript(passwordPath: string): string {
  return `#!/bin/sh\ncat "${passwordPath}"\n`
}

/**
 * Build the elevated command for POSIX. When the OS already has cached sudo
 * (sudo -n true succeeds), prepend `sudo` plainly. Otherwise, set up the
 * askpass dance: write the password file, generate the helper script, and
 * return the env additions (SUDO_ASKPASS) the caller must merge into the
 * spawn env.
 *
 * The caller is responsible for the finalizer that deletes the password
 * file and helper script.
 */
export interface ElevationResult {
  /** The argv prefix to prepend to the command (e.g. ["sudo"] or ["sudo", "-A", "-p", ""]). */
  argv: string[]
  /** Env additions to merge into the spawn env (e.g. { SUDO_ASKPASS: <path> }). */
  env: Record<string, string>
  /** Files to delete in a finalizer (password file, helper script). */
  cleanup: string[]
}

/**
 * Decide the elevation strategy for a command. Returns the argv prefix and
 * env additions the caller should use; or null when no elevation is needed
 * (the user is already root, or the mode is "off").
 *
 * This function does NOT execute anything — it's a pure decision. The
 * caller (shell.ts) is responsible for actually spawning the elevated
 * command and running the cleanup finalizer.
 */
export function planElevation(input: {
  config: ElevationConfig
  hasCachedSudo: boolean
  password: Redacted | undefined
}): ElevationResult | null {
  if (input.config.mode === "off") return null
  // Already root?
  if (process.getuid?.() === 0) return null

  if (input.hasCachedSudo) {
    // OS already has cached credentials — prepend sudo normally.
    return { argv: ["sudo"], env: {}, cleanup: [] }
  }
  if (input.password === undefined) {
    // No password available — caller should fall back to a clean permission
    // error rather than prompting interactively (the server has no tty).
    return null
  }
  // Askpass path: write the password file + helper script.
  const { helperPath, passwordPath } = askpassPaths()
  return {
    argv: ["sudo", "-A", "-p", ""],
    env: { SUDO_ASKPASS: helperPath },
    cleanup: [helperPath, passwordPath],
  }
}

export * as Elevation from "./elevation"
