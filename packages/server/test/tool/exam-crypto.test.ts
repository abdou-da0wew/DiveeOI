import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { decryptExamSecret, encryptExamSecret, resetExamEncryptionKeyCacheForTests } from "../../src/exam/crypto"

describe("private exam answer-key encryption", () => {
  const originalEnv = process.env.DIVEEOI_EXAM_ENCRYPTION_KEY
  let directory = ""

  afterEach(async () => {
    resetExamEncryptionKeyCacheForTests()
    if (originalEnv === undefined) delete process.env.DIVEEOI_EXAM_ENCRYPTION_KEY
    else process.env.DIVEEOI_EXAM_ENCRYPTION_KEY = originalEnv
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  test("encrypts and decrypts values with a stable locally protected key", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "diveeoi-exam-secret-"))
    delete process.env.DIVEEOI_EXAM_ENCRYPTION_KEY
    const secret = { question: "q1", correctOptionIDs: ["private-answer"] }
    const encrypted = await encryptExamSecret(secret, directory)
    expect(encrypted.ciphertext).not.toContain("private-answer")
    expect(await decryptExamSecret<typeof secret>(encrypted, directory)).toEqual(secret)
    resetExamEncryptionKeyCacheForTests()
    expect(await decryptExamSecret<typeof secret>(encrypted, directory)).toEqual(secret)
  })

  test("rejects invalid configured keys rather than silently weakening encryption", async () => {
    process.env.DIVEEOI_EXAM_ENCRYPTION_KEY = "too-short"
    resetExamEncryptionKeyCacheForTests()
    await expect(encryptExamSecret({ answer: "x" })).rejects.toThrow("must be 32 bytes")
  })
})
