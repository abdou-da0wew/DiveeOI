import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  DIVEEOI_CHANNEL: process.env["DIVEEOI_CHANNEL"],
  DIVEEOI_BUMP: process.env["DIVEEOI_BUMP"],
  DIVEEOI_VERSION: process.env["DIVEEOI_VERSION"],
  DIVEEOI_RELEASE: process.env["DIVEEOI_RELEASE"],
  // legacy opencode env vars for backwards compatibility
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.DIVEEOI_CHANNEL) return env.DIVEEOI_CHANNEL
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.DIVEEOI_BUMP || env.OPENCODE_BUMP) return "latest"
  if ((env.DIVEEOI_VERSION || env.OPENCODE_VERSION) && !(env.DIVEEOI_VERSION || env.OPENCODE_VERSION).startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const timestamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")

const latestUpstream = async (): Promise<string | undefined> => {
  try {
    return await fetch("https://registry.npmjs.org/opencode-ai/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.version as string)
  } catch {
    console.warn("Failed to fetch latest version from npm registry")
    return undefined
  }
}

const nextPatch = (version: string) => {
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  return `${major}.${minor}.${patch + 1}`
}

const VERSION = await (async () => {
  if (env.DIVEEOI_VERSION) return env.DIVEEOI_VERSION
  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION
  const latest = await latestUpstream()
  if (IS_PREVIEW) {
    // Preview builds still talk to upstream services that version-gate clients
    // (the opencode free tier requires a recent release; a 0.0.0-* version is
    // always rejected). Use the next patch above upstream's latest release as a
    // plain release-style string — npm semver ranges like >=1.17.0 exclude
    // prerelease suffixes, so a `1.17.1-dev-*` form would fail the same gate.
    return latest ? nextPatch(latest) : `0.0.0-${CHANNEL}-${timestamp()}`
  }
  if (latest) {
    const [major, minor, patch] = latest.split(".").map((x: string) => Number(x) || 0)
    const t = env.DIVEEOI_BUMP || env.OPENCODE_BUMP
    if (t?.toLowerCase() === "major") return `${major + 1}.0.0`
    if (t?.toLowerCase() === "minor") return `${major}.${minor + 1}.0`
    return `${major}.${minor}.${patch + 1}`
  }
  return `0.0.0-${CHANNEL}-${timestamp()}`
})()

const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
let team: string[] = []
try {
  const content = await Bun.file(teamPath).text()
  team = content.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"))
} catch {
  // file not found or unreadable, team stays empty
}

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!(env.DIVEEOI_RELEASE || env.OPENCODE_RELEASE)
  },
  get team() {
    return team
  },
}
console.log(`diveeoi script`, JSON.stringify(Script, null, 2))
