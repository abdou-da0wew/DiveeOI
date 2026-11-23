import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Stream } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"
import { layer as sqliteBunLayer } from "@diveeoi/db/database/sqlite.bun"
import { tmpdir } from "./fixture/tmpdir"

/**
 * executeStream used to be `Stream.die("executeStream not implemented")` in all
 * three SQLite connection adapters (sqlite.bun, sqlite.node, effect-sqlite-node)
 * — any new consumer of Statement.stream crashed at runtime, not typecheck.
 * These tests pin the new contract: rows stream back instead of dying.
 */

const withConnection = Effect.gen(function* () {
  const client = yield* SqlClient
  return yield* client.reserve
})

const expected = [
  { id: 1, name: "one" },
  { id: 2, name: "two" },
  { id: 3, name: "three" },
]

// Same shape as Statement.defaultTransforms(...).array: a generic row-array
// name transformer.
const upperKeys = <A extends object>(row: ReadonlyArray<A>): ReadonlyArray<A> =>
  row.map((r) =>
    Object.fromEntries(
      Object.entries(r as Record<string, unknown>).map(([k, v]) => [k.toUpperCase(), v]),
    ) as A,
  )

describe("executeStream", () => {
  test("bun driver streams rows instead of dying", async () => {
    await using tmp = await tmpdir()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const connection = yield* withConnection
        yield* connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", [], undefined)
        yield* connection.execute(
          "INSERT INTO t (id, name) VALUES (1, 'one'), (2, 'two'), (3, 'three')",
          [],
          undefined,
        )
        const rows = yield* Stream.runCollect(
          connection.executeStream("SELECT id, name FROM t ORDER BY id", [], undefined),
        )
        const streamed = Array.from(rows as Iterable<Record<string, unknown>>)
        // The effect-based path must agree with the streaming path.
        const effectRows = yield* connection.execute("SELECT id, name FROM t ORDER BY id", [], undefined)
        return { streamed, effectRows: Array.from(effectRows as Iterable<Record<string, unknown>>) }
      }).pipe(Effect.provide(sqliteBunLayer({ filename: path.join(tmp.path, "stream.sqlite") })), Effect.scoped),
    )
    expect(result.streamed).toEqual(expected)
    expect(result.streamed).toEqual(result.effectRows)
  })

  test("stream respects transformRows", async () => {
    await using tmp = await tmpdir()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const connection = yield* withConnection
        yield* connection.execute("CREATE TABLE t (some_id INTEGER PRIMARY KEY)", [], undefined)
        yield* connection.execute("INSERT INTO t (some_id) VALUES (7)", [], undefined)
        const rows = yield* Stream.runCollect(
          connection.executeStream("SELECT some_id FROM t", [], upperKeys),
        )
        return Array.from(rows as Iterable<{ SOME_ID: number }>)
      }).pipe(
        Effect.provide(sqliteBunLayer({ filename: path.join(tmp.path, "stream-transform.sqlite") })),
        Effect.scoped,
      ),
    )
    expect(result).toEqual([{ SOME_ID: 7 }])
  })

  test("query failures surface as SqlError, not defects", async () => {
    await using tmp = await tmpdir()
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const connection = yield* withConnection
        return yield* Effect.flip(
          Stream.runCollect(connection.executeStream("SELECT * FROM missing_table", [], undefined)),
        )
      }).pipe(
        Effect.provide(sqliteBunLayer({ filename: path.join(tmp.path, "stream-error.sqlite") })),
        Effect.scoped,
      ),
    )
    expect(error).toBeInstanceOf(SqlError)
  })
})
