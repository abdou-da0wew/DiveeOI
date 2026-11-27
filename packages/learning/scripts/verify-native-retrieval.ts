// End-to-end proof: the native retrieval sidecar (divee-retrieval) answers a
// one-shot query against a real books.db built with the production schema.
// Usage: bun scripts/verify-native-retrieval.ts
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SCHEMA_SQL } from "../src/store/schema"

const tempDir = mkdtempSync(join(tmpdir(), "tl-native-e2e-"))
const dbPath = join(tempDir, "books.db")
const db = new BunDatabase(dbPath)
db.exec(SCHEMA_SQL)

const vectorToB64 = (vec: Float32Array): string => {
  const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

db.run(
  "INSERT INTO books(id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  "bio", "biology", "Biology 101", "h1", "bio.pdf", "ready", "{}", 1, Date.now(),
)
db.run(
  "INSERT INTO sections(id, book_id, level, ord, text, heading_path) VALUES(?,?,?,?,?,?)",
  "bio-s1", "bio", 1, 0, "Photosynthesis is the process by which plants convert sunlight into glucose.", "Chapter 1",
)
db.run(
  "INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
  "bio-c1", "bio", "bio-s1", 0,
  "Photosynthesis converts sunlight into glucose and oxygen.",
  "photosynthesis converts sunlight into glucose and oxygen", 10,
)
db.run(
  "INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
  "bio-c2", "bio", "bio-s1", 1,
  "Chlorophyll absorbs light energy.",
  "chlorophyll absorbs light energy", 6,
)
db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)", "bio-c1", vectorToB64(new Float32Array([0.9, 0.1, 0.0, 0.0])))
db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)", "bio-c2", vectorToB64(new Float32Array([0.8, 0.2, 0.0, 0.0])))
db.close()

const binary = join(import.meta.dir, "..", "native", "retrieval", "target", "release", "divee-retrieval")
const queryVec = vectorToB64(new Float32Array([0.85, 0.15, 0.0, 0.0]))

const proc = Bun.spawn([
  binary, "--db", dbPath, "--query", "photosynthesis",
  "--book", "bio", "--vector-base64", queryVec, "--bm25-limit", "10", "--dense-limit", "10", "--limit", "5", "--no-model",
])
const stdout = await new Response(proc.stdout).text()
const exit = await proc.exited
if (exit !== 0) {
  console.error("divee-retrieval exited", exit)
  console.error(await new Response(proc.stderr).text())
  process.exit(1)
}

const payload = JSON.parse(stdout) as {
  hits?: Array<{ chunk_id?: string; id?: string; bm25_score?: number; dense_score?: number; fused_score?: number; text?: string }>
  encoder?: string
}
const hits = payload.hits ?? []
console.log(`divee-retrieval one-shot answered ${hits.length} hit(s):`)
for (const hit of hits) {
  const id = hit.chunk_id ?? hit.id
  console.log(`  - ${id}  bm25=${hit.bm25_score?.toFixed(3)} dense=${hit.dense_score?.toFixed(3)} fused=${hit.fused_score?.toFixed(3)}  "${(hit.text ?? "").slice(0, 60)}"`)
}
rmSync(tempDir, { recursive: true, force: true })
const top = hits[0]
const ok = top && (top.chunk_id === "bio-c1" || top.id === "bio-c1")
console.log(ok ? "NATIVE-RETRIEVAL-OK (top hit = expected chunk)" : "NATIVE-RETRIEVAL-CHECK (top hit differs from expectation)")
