import { createHmac, timingSafeEqual } from "node:crypto"
import { minimatch } from "minimatch"

interface KnownHostEntry {
  marker?: string
  hosts: string[]
  keyType: string
  key: string
}

function parseKnownHostEntries(source: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue

    const parts = line.split(/\s+/)
    const marker = parts[0]?.startsWith("@") ? parts.shift() : undefined
    const [hostList, keyType, key] = parts
    if (!hostList || !keyType || !key || (!keyType.startsWith("ssh-") && !keyType.startsWith("ecdsa-"))) {
      continue
    }
    entries.push({
      ...(marker ? { marker } : {}),
      hosts: hostList.split(","),
      keyType,
      key,
    })
  }
  return entries
}

function matchesHashedHost(pattern: string, candidate: string) {
  const parts = pattern.split("|")
  const [, version, saltValue, expectedValue] = parts
  if (version !== "1" || !saltValue || !expectedValue) return false

  try {
    const salt = Buffer.from(saltValue, "base64")
    const expected = Buffer.from(expectedValue, "base64")
    const actual = createHmac("sha1", salt).update(candidate).digest()
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function matchesHostPattern(pattern: string, candidates: string[]) {
  if (pattern.startsWith("|1|")) return candidates.some((candidate) => matchesHashedHost(pattern, candidate))
  return candidates.some((candidate) => minimatch(candidate, pattern, { nocase: true, dot: true }))
}

function entryMatchesHost(entry: KnownHostEntry, candidates: string[]) {
  let positive = false
  let hasPositive = false

  for (const pattern of entry.hosts) {
    if (pattern.startsWith("!")) {
      if (matchesHostPattern(pattern.slice(1), candidates)) return false
      continue
    }
    hasPositive = true
    if (matchesHostPattern(pattern, candidates)) positive = true
  }

  return hasPositive && positive
}

export function createSSHHostKeyVerifier(host: string, port: number, knownHosts: string) {
  const entries = parseKnownHostEntries(knownHosts)
  const normalizedHost = host.replace(/^\[|\]$/g, "").toLowerCase()
  const candidates = port === 22 ? [normalizedHost] : [`[${normalizedHost}]:${port}`]
  const matchingEntries = entries.filter((entry) => entryMatchesHost(entry, candidates))

  return (presentedKey: Buffer) => {
    const key = presentedKey.toString("base64")
    const matchingKey = matchingEntries.filter(
      (entry) => entry.keyType === getKeyType(presentedKey) && entry.key === key,
    )
    if (matchingKey.some((entry) => entry.marker === "@revoked")) return false
    return matchingKey.some((entry) => !entry.marker)
  }
}

function getKeyType(key: Buffer) {
  const length = key.readUInt32BE(0)
  return key.subarray(4, 4 + length).toString("ascii")
}

export * as SSHHostVerifier from "./ssh-host-verifier"
