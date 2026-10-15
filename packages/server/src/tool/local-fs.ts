// packages/server/src/tool/local-fs.ts
// LocalFS service — the always-local filesystem escape hatch.
//
// When a session is remote (SSH), the active FSUtil.Service is swapped to the
// SFTP-backed layer. Tools that accept a `ctx_local: true` parameter need to
// be able to access the LOCAL filesystem regardless of the session's remote
// state. This service is always provided at app boot with the Node.js
// filesystem layer and is never replaced.

import { Context, Effect, Layer, FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { FSUtil as FSUtilModule } from "@diveeoi/db/fs-util"

export type LocalFSShape = FSUtilModule.Interface

export class Service extends Context.Service<Service, LocalFSShape>()("@diveeoi/LocalFS") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return Service.of(fs as unknown as LocalFSShape)
  }),
).pipe(Layer.provide(NodeFileSystem.layer))

export * as LocalFS from "./local-fs"
