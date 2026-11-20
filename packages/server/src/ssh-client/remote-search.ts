import { Effect } from "effect"
import type { Connection } from "./types"

function quote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function unavailable(result: { exitCode: number; stderr: string }) {
  if (result.exitCode === 127 || /rg: (not found|command not found)/i.test(result.stderr)) {
    throw new Error(
      "Remote ripgrep (rg) is not installed. Install ripgrep on the SSH host to use remote grep and glob.",
    )
  }
}

export function glob(connection: Connection, cwd: string, pattern: string, limit = 100) {
  return connection
    .exec(`rg --files --hidden --color never --glob ${quote(pattern)} --glob '!**/.git/**' .`, {
      cwd,
      timeoutMs: 30_000,
    })
    .pipe(
      Effect.map((result) => {
        unavailable(result)
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          throw new Error(result.stderr || `Remote glob failed with exit code ${result.exitCode}`)
        }
        const paths = result.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, limit)
          .map((value) => (value.startsWith("/") ? value : `${cwd.replace(/\/$/, "")}/${value.replace(/^\.\//, "")}`))
        return { paths, truncated: result.stdout.split(/\r?\n/).filter(Boolean).length > limit }
      }),
    )
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}

export function grep(connection: Connection, cwd: string, pattern: string, include?: string, limit = 100) {
  const includeArg = include ? `--glob ${quote(include)} ` : ""
  const command = `rg --line-number --no-heading --color never --max-count 20 --max-columns 500 --max-columns-preview ${includeArg}-- ${quote(pattern)} .`
  return connection.exec(command, { cwd, timeoutMs: 30_000 }).pipe(
    Effect.map((result) => {
      unavailable(result)
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr || `Remote grep failed with exit code ${result.exitCode}`)
      }
      const matches: GrepMatch[] = []
      for (const line of result.stdout.split(/\r?\n/)) {
        if (!line) continue
        const match = line.match(/^(.+):(\d+):(.*)$/)
        if (!match) continue
        const file = match[1].startsWith("/") ? match[1] : `${cwd.replace(/\/$/, "")}/${match[1].replace(/^\.\//, "")}`
        matches.push({ path: file, line: Number(match[2]), text: match[3] })
        if (matches.length >= limit) break
      }
      return {
        matches,
        truncated: matches.length >= limit && result.stdout.split(/\r?\n/).filter(Boolean).length > limit,
      }
    }),
  )
}

export * from "./remote-search"
