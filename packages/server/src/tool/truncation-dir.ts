import path from "path"
import os from "os"

/**
 * Directory where oversized tool outputs are persisted so the agent can re-access
 * the full content with targeted commands (grep -n, sed -n line ranges, head/tail)
 * instead of it being loaded into the model context.
 *
 * Lives under the OS temp dir: the files are a convenience cache for the running
 * session, not durable data — the OS may reap them, and the hourly cleanup in
 * truncate.ts prunes anything older than the 7-day retention window anyway.
 */
export const TRUNCATION_DIR = path.join(os.tmpdir(), "diveeoi-tool-output")
