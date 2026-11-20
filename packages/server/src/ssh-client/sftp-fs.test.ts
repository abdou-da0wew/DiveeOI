import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { SftpSession, SftpStat, SftpEntry } from "./types"
import { createSftpDiscovery } from "./sftp-discovery"
import { makeSftpFs } from "./sftp-fs"

type NodeValue = { directory: boolean; content?: Uint8Array; mode: number }

function createMemorySftp() {
  const nodes = new Map<string, NodeValue>([
    ["/", { directory: true, mode: 0o755 }],
    ["/srv", { directory: true, mode: 0o755 }],
    ["/srv/AGENTS.md", { directory: false, content: new TextEncoder().encode("root guidance"), mode: 0o644 }],
    ["/srv/app", { directory: true, mode: 0o755 }],
    ["/srv/app/AGENTS.md", { directory: false, content: new TextEncoder().encode("app guidance"), mode: 0o644 }],
    ["/srv/app/src", { directory: true, mode: 0o755 }],
    ["/srv/app/src/main.ts", { directory: false, content: new TextEncoder().encode("main"), mode: 0o644 }],
    ["/srv/app/src/.cache.ts", { directory: false, content: new TextEncoder().encode("hidden"), mode: 0o644 }],
    ["/srv/app/src/nested", { directory: true, mode: 0o755 }],
    ["/srv/app/src/nested/tool.ts", { directory: false, content: new TextEncoder().encode("tool"), mode: 0o644 }],
    [
      "/srv/app/src/nested/AGENTS.md",
      { directory: false, content: new TextEncoder().encode("nested guidance"), mode: 0o644 },
    ],
  ])
  const normalize = (value: string) => {
    const parts: string[] = []
    for (const part of value.split("/")) {
      if (!part || part === ".") continue
      if (part === "..") parts.pop()
      else parts.push(part)
    }
    return `/${parts.join("/")}`
  }
  const stat = (value: string): Effect.Effect<SftpStat, Error> => {
    const node = nodes.get(normalize(value))
    if (!node) return Effect.fail(new Error(`No such file: ${value}`))
    return Effect.succeed({
      isFile: !node.directory,
      isDirectory: node.directory,
      size: node.content?.byteLength ?? 0,
      mtime: 1,
      atime: 1,
      mode: node.mode,
    })
  }
  const listDir = (value: string): Effect.Effect<ReadonlyArray<SftpEntry>, Error> => {
    const directory = normalize(value)
    const node = nodes.get(directory)
    if (!node?.directory) return Effect.fail(new Error(`Not a directory: ${value}`))
    const entries: SftpEntry[] = []
    for (const [candidate, child] of nodes) {
      if (candidate === directory || normalize(candidate.slice(0, candidate.lastIndexOf("/")) || "/") !== directory) {
        continue
      }
      const name = candidate.slice(candidate.lastIndexOf("/") + 1)
      entries.push({
        name,
        longname: name,
        isFile: !child.directory,
        isDirectory: child.directory,
        isSymbolicLink: false,
        size: child.content?.byteLength ?? 0,
        mtime: 1,
        atime: 1,
      })
    }
    return Effect.succeed(entries)
  }
  const sftp: SftpSession = {
    readFile: (value) => {
      const node = nodes.get(normalize(value))
      return node?.content ? Effect.succeed(node.content) : Effect.fail(new Error("No such file"))
    },
    writeFile: (value, data) => {
      const filePath = normalize(value)
      const parent = filePath.slice(0, filePath.lastIndexOf("/")) || "/"
      if (!nodes.get(parent)?.directory) return Effect.fail(new Error("Parent directory missing"))
      nodes.set(filePath, {
        directory: false,
        content: typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data),
        mode: 0o644,
      })
      return Effect.void
    },
    stat,
    listDir,
    mkdir: (value) => {
      const directory = normalize(value)
      const parent = directory.slice(0, directory.lastIndexOf("/")) || "/"
      if (!nodes.get(parent)?.directory) return Effect.fail(new Error("Parent directory missing"))
      if (nodes.has(directory)) return Effect.fail(new Error("Already exists"))
      nodes.set(directory, { directory: true, mode: 0o755 })
      return Effect.void
    },
    chmod: (value, mode) => {
      const node = nodes.get(normalize(value))
      if (!node) return Effect.fail(new Error("No such file"))
      node.mode = mode
      return Effect.void
    },
    remove: (value) => {
      nodes.delete(normalize(value))
      return Effect.void
    },
    removeDirectory: (value) => {
      const directory = normalize(value)
      if ([...nodes.keys()].some((candidate) => candidate !== directory && candidate.startsWith(`${directory}/`))) {
        return Effect.fail(new Error("Directory is not empty"))
      }
      nodes.delete(directory)
      return Effect.void
    },
    rename: (source, destination) => {
      const from = normalize(source)
      const to = normalize(destination)
      const node = nodes.get(from)
      if (!node) return Effect.fail(new Error("No such file"))
      nodes.set(to, node)
      nodes.delete(from)
      return Effect.void
    },
    realpath: (value) => Effect.succeed(normalize(value)),
  }
  return { sftp, nodes }
}

describe("SFTP filesystem discovery", () => {
  test("glob supports recursive, static-prefix, absolute, and dot-file patterns", async () => {
    const { sftp } = createMemorySftp()
    const discovery = createSftpDiscovery(sftp, "/srv/app")
    const files = await Effect.runPromise(discovery.glob("src/**/*.ts", { absolute: true }))
    expect(files).toEqual(["/srv/app/src/main.ts", "/srv/app/src/nested/tool.ts"])

    const hidden = await Effect.runPromise(
      discovery.glob("src/**/*.ts", { cwd: "/srv/app", absolute: true, dot: true }),
    )
    expect(hidden).toContain("/srv/app/src/.cache.ts")
  })

  test("findUp, up, groupUp, and globUp walk from the current directory to the root", async () => {
    const { sftp } = createMemorySftp()
    const discovery = createSftpDiscovery(sftp, "/srv/app")
    const found = await Effect.runPromise(discovery.findUp("AGENTS.md", "/srv/app/src/nested"))
    expect(found).toEqual(["/srv/app/src/nested/AGENTS.md", "/srv/app/AGENTS.md", "/srv/AGENTS.md"])

    const grouped = await Effect.runPromise(discovery.groupUp(["AGENTS.md"], "/srv/app/src/nested", "/srv/app"))
    expect(grouped).toEqual([
      { path: "/srv/app", target: "AGENTS.md" },
      { path: "/srv/app/src/nested", target: "AGENTS.md" },
    ])

    const globbed = await Effect.runPromise(discovery.globUp("AGENTS.md", "/srv/app/src/nested", "/srv/app"))
    expect(globbed).toEqual(["/srv/app/src/nested/AGENTS.md", "/srv/app/AGENTS.md"])
  })

  test("writeWithDirs creates missing remote parent directories recursively", async () => {
    const { sftp, nodes } = createMemorySftp()
    const fs = makeSftpFs(sftp, "linux", "/srv/app")
    await Effect.runPromise(fs.writeWithDirs("/srv/app/new/deep/file.md", "remote content", 0o600))
    const created = nodes.get("/srv/app/new/deep/file.md")
    expect(created).toBeDefined()
    expect(new TextDecoder().decode(created?.content)).toBe("remote content")
    expect(created?.mode).toBe(0o600)
    expect(nodes.get("/srv/app/new")?.directory).toBe(true)
    expect(nodes.get("/srv/app/new/deep")?.directory).toBe(true)
  })

  test("copyFile creates destination parents and directory removal uses rmdir", async () => {
    const { sftp, nodes } = createMemorySftp()
    const fs = makeSftpFs(sftp, "linux", "/srv/app")
    await Effect.runPromise(fs.copyFile("/srv/app/src/main.ts", "/srv/app/copies/deep/main.ts"))
    expect(new TextDecoder().decode(nodes.get("/srv/app/copies/deep/main.ts")?.content)).toBe("main")

    await Effect.runPromise(fs.ensureDir("/srv/app/empty-directory"))
    await Effect.runPromise(fs.remove("/srv/app/empty-directory"))
    expect(nodes.has("/srv/app/empty-directory")).toBe(false)
  })
})
