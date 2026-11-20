import type { Effect, Scope, Stream } from "effect"

export interface RemoteConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly auth:
    | { kind: "password"; password: string }
    | { kind: "privateKey"; keyPath: string; passphrase?: string }
    | { kind: "agent"; socketPath?: string }
  readonly workingDirectory: string
  readonly platform?: NodeJS.Platform
  readonly identity?: string
  readonly keepaliveIntervalMs?: number
}

export interface ExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface SftpStat {
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly size: number
  readonly mtime: number
  readonly atime: number
  readonly mode: number
}

export interface SftpEntry {
  readonly name: string
  readonly longname: string
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
  readonly size: number
  readonly mtime: number
  readonly atime: number
}

export interface SftpSession {
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, Error>
  readonly writeFile: (path: string, data: Uint8Array | string) => Effect.Effect<void, Error>
  readonly stat: (path: string) => Effect.Effect<SftpStat, Error>
  readonly listDir: (path: string) => Effect.Effect<ReadonlyArray<SftpEntry>, Error>
  readonly mkdir: (path: string) => Effect.Effect<void, Error>
  readonly chmod: (path: string, mode: number) => Effect.Effect<void, Error>
  readonly remove: (path: string) => Effect.Effect<void, Error>
  readonly removeDirectory: (path: string) => Effect.Effect<void, Error>
  readonly rename: (oldPath: string, newPath: string) => Effect.Effect<void, Error>
  readonly realpath: (path: string) => Effect.Effect<string, Error>
}

export interface Connection {
  readonly config: RemoteConfig
  readonly exec: (
    command: string,
    options?: {
      cwd?: string
      env?: Record<string, string>
      stdin?: string | Uint8Array
      timeoutMs?: number
    },
  ) => Effect.Effect<ExecResult, Error>
  readonly execStream: (
    command: string,
    options?: {
      cwd?: string
      env?: Record<string, string>
      includeStderr?: boolean
    },
  ) => Stream.Stream<string, Error>
  readonly sftp: () => Effect.Effect<SftpSession, Error>
  readonly close: () => Effect.Effect<void, Error>
}

export interface Interface {
  readonly acquire: (config: RemoteConfig) => Effect.Effect<Connection, Error, Scope.Scope>
  readonly has: (config: RemoteConfig) => Effect.Effect<boolean>
  readonly probe: (
    config: RemoteConfig,
  ) => Effect.Effect<{ ok: true; platform: NodeJS.Platform; homeDirectory: string } | { ok: false; reason: string }>
}
