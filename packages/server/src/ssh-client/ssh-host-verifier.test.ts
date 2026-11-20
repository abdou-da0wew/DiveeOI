import { createHmac } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { createSSHHostKeyVerifier } from "./ssh-host-verifier"

function makeKey() {
  const algorithm = Buffer.from("ssh-ed25519")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(algorithm.length)
  return Buffer.concat([length, algorithm, Buffer.alloc(32, 7)])
}

function encodeKey(key: Buffer) {
  return `ssh-ed25519 ${key.toString("base64")}`
}

function hashHost(host: string, salt: Buffer) {
  const digest = createHmac("sha1", salt).update(host).digest()
  return `|1|${salt.toString("base64")}|${digest.toString("base64")}`
}

describe("SSH host-key verification", () => {
  test("accepts only the configured host and exact known key", () => {
    const key = makeKey()
    const knownHosts = `remote.example.test ${encodeKey(key)}`

    expect(createSSHHostKeyVerifier("remote.example.test", 22, knownHosts)(key)).toBe(true)
    expect(createSSHHostKeyVerifier("other.example.test", 22, knownHosts)(key)).toBe(false)
    expect(createSSHHostKeyVerifier("remote.example.test", 2200, knownHosts)(key)).toBe(false)
    expect(createSSHHostKeyVerifier("remote.example.test", 22, "")(key)).toBe(false)
  })

  test("matches non-default ports and hashed known_hosts entries", () => {
    const key = makeKey()
    const host = "[remote.example.test]:2200"
    const hashed = hashHost(host, Buffer.from("known-host-salt"))
    const knownHosts = `${hashed} ${encodeKey(key)}`

    expect(createSSHHostKeyVerifier("remote.example.test", 2200, knownHosts)(key)).toBe(true)
    expect(createSSHHostKeyVerifier("remote.example.test", 22, knownHosts)(key)).toBe(false)
  })

  test("honours wildcard exclusions and revoked keys", () => {
    const key = makeKey()
    const encoded = encodeKey(key)
    const wildcard = `*.example.test,!blocked.example.test ${encoded}`
    const revoked = `@revoked trusted.example.test ${encoded}`

    expect(createSSHHostKeyVerifier("good.example.test", 22, wildcard)(key)).toBe(true)
    expect(createSSHHostKeyVerifier("blocked.example.test", 22, wildcard)(key)).toBe(false)
    expect(createSSHHostKeyVerifier("trusted.example.test", 22, revoked)(key)).toBe(false)
  })
})
