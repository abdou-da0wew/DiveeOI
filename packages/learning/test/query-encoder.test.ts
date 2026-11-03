import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { setRuntime } from "../src/runtime"
import {
  releaseTeacherAfterIndexing,
  resolveEncoder,
  STUDENT_DIR_NAME,
  STUDENT_MANIFEST_FILE,
  studentStatus,
  type StudentManifest,
} from "../src/embed/query-encoder"

let dir: string
let modelDir: string

const installTeacher = () => {
  const onnx = join(modelDir, PINNED_MANIFEST.repo, "onnx")
  mkdirSync(onnx, { recursive: true })
  writeFileSync(join(onnx, "model_int8.onnx"), "x")
}

const installStudent = (patch: Partial<StudentManifest> = {}, files = { onnx: true, tokenizer: true }) => {
  const root = join(modelDir, STUDENT_DIR_NAME)
  mkdirSync(join(root, "onnx"), { recursive: true })
  const manifest: StudentManifest = {
    format: 1,
    name: STUDENT_DIR_NAME,
    dims: 1024,
    teacherRepo: PINNED_MANIFEST.repo,
    teacherRevision: PINNED_MANIFEST.revision,
    dtype: "int8",
    maxLength: 128,
    promoted: false,
    ...patch,
  }
  writeFileSync(join(root, STUDENT_MANIFEST_FILE), JSON.stringify(manifest))
  if (files.onnx) writeFileSync(join(root, "onnx", "model_int8.onnx"), "x")
  if (files.tokenizer) writeFileSync(join(root, "tokenizer.json"), "{}")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tl-query-encoder-"))
  modelDir = join(dir, "models")
  mkdirSync(modelDir, { recursive: true })
  setRuntime({ dataDir: dir, modelDir, booksStore: {} as never, manifest: PINNED_MANIFEST })
})

afterEach(() => {
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

describe("query encoder resolution", () => {
  test("nothing installed resolves to none", () => {
    expect(resolveEncoder().encoder).toBe("none")
  })

  test("auto uses BGE-M3 when there is no student", () => {
    installTeacher()
    const resolved = resolveEncoder()
    expect(resolved.encoder).toBe("bge-m3")
    expect(resolved.reason).toContain("no student")
  })

  test("auto does not use a student that has not been promoted", () => {
    installTeacher()
    installStudent({ promoted: false })
    const resolved = resolveEncoder()
    expect(resolved.encoder).toBe("bge-m3")
    expect(resolved.reason).toContain("not promoted")
  })

  test("auto uses a promoted student without needing the teacher and exposes its calibrated gate", () => {
    installStudent({ promoted: true, gate: { minDenseScore: 0.41 } })
    const resolved = resolveEncoder()
    expect(resolved.encoder).toBe("student")
    expect(resolved.gate?.minDenseScore).toBe(0.41)
  })

  test("a student distilled from another teacher revision is never used", () => {
    installTeacher()
    installStudent({ promoted: true, teacherRevision: "0000000" })
    expect(resolveEncoder().encoder).toBe("bge-m3")
    expect(resolveEncoder({ retrieval: { queryEncoder: "student" } }).encoder).toBe("bge-m3")
  })

  test("a student with the wrong dimensionality, or missing files, is rejected", () => {
    installStudent({ promoted: true, dims: 384 })
    expect(studentStatus(modelDir, PINNED_MANIFEST).available).toBe(false)
    rmSync(join(modelDir, STUDENT_DIR_NAME), { recursive: true, force: true })
    installStudent({ promoted: true }, { onnx: false, tokenizer: true })
    expect(studentStatus(modelDir, PINNED_MANIFEST).reason).toContain("ONNX")
    rmSync(join(modelDir, STUDENT_DIR_NAME), { recursive: true, force: true })
    installStudent({ promoted: true }, { onnx: true, tokenizer: false })
    expect(studentStatus(modelDir, PINNED_MANIFEST).reason).toContain("tokenizer")
  })

  test("forcing the student skips the promotion check but not compatibility", () => {
    installTeacher()
    installStudent({ promoted: false })
    expect(resolveEncoder({ retrieval: { queryEncoder: "student" } }).encoder).toBe("student")
  })

  test("forcing bge-m3 ignores a promoted student", () => {
    installTeacher()
    installStudent({ promoted: true })
    expect(resolveEncoder({ retrieval: { queryEncoder: "bge-m3" } }).encoder).toBe("bge-m3")
  })

  test("forcing the student without one falls back to the teacher, then to none", () => {
    installTeacher()
    const fallback = resolveEncoder({ retrieval: { queryEncoder: "student" } })
    expect(fallback.encoder).toBe("bge-m3")
    expect(fallback.reason).toContain("student unavailable")
    rmSync(join(modelDir, PINNED_MANIFEST.repo), { recursive: true, force: true })
    expect(resolveEncoder({ retrieval: { queryEncoder: "student" } }).encoder).toBe("none")
  })
})

describe("index-and-forget", () => {
  test("keeps the teacher while jobs are active", async () => {
    installStudent({ promoted: true })
    expect(await releaseTeacherAfterIndexing(undefined, 1)).toBe(false)
  })

  test("keeps the teacher when chat still needs it", async () => {
    installTeacher()
    expect(await releaseTeacherAfterIndexing(undefined, 0)).toBe(false)
  })

  test("releases the teacher when the queue is empty and chat uses the student", async () => {
    installStudent({ promoted: true })
    expect(await releaseTeacherAfterIndexing(undefined, 0)).toBe(true)
  })

  test("respects the opt-out setting", async () => {
    installStudent({ promoted: true })
    expect(await releaseTeacherAfterIndexing({ retrieval: { unloadTeacherAfterIndexing: false } }, 0)).toBe(false)
  })
})
