// packages/server/src/tool/machine/index.ts
// Machine tools (draft-10 P6): cross-platform system-interaction tools.
//
// Each tool follows the same shape as the existing built-ins (read, glob,
// etc.): a Schema parameters struct, a Tool.define, and a permission default
// that matches the plan (auto for read-only, approval for destructive ops).
//
// Per-tool files (notify.ts, system-info.ts, processes.ts, kill-process.ts,
// http-request.ts, screenshot.ts, clipboard.ts, watch-file.ts, open-url.ts,
// glob-search.ts) implement the OS branches. The registry picks them up via
// the lazy-tool discovery path (packages/server/src/tool/registry.ts) or
// explicit registration here.

export { NotifyTool } from "./notify"
export { SystemInfoTool } from "./system-info"
export { ListProcessesTool } from "./list-processes"
export { KillProcessTool } from "./kill-process"
export { HttpRequestTool } from "./http-request"
export { ScreenshotTool } from "./screenshot"
export { ClipboardReadTool, ClipboardWriteTool } from "./clipboard"
export { WatchFileTool } from "./watch-file"
export { OpenUrlTool } from "./open-url"
export { GlobSearchTool } from "./glob-search"

export * as Machine from "./index"
