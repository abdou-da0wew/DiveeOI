import { describe, expect, test } from "bun:test"
import { Duration, Effect } from "effect"
import { AccountDeviceLogin } from "@/account/device-login"
import {
  DeviceCode,
  Login,
  UserCode,
  PollDenied,
  PollError,
  PollExpired,
  PollPending,
  PollSlow,
  PollSuccess,
  type PollResult,
} from "@/account/schema"

const login = (overrides: { expiry?: Duration.Duration; interval?: Duration.Duration } = {}) =>
  new Login({
    code: DeviceCode.make("device-code-abc"),
    user: UserCode.make("WXYZ-1234"),
    url: "https://opencode.ai/console/device?user_code=WXYZ-1234",
    server: "https://opencode.ai/console",
    expiry: overrides.expiry ?? Duration.seconds(600),
    interval: overrides.interval ?? Duration.seconds(5),
  })

const run = <A>(effect: Effect.Effect<A, never, never>) => Effect.runPromise(Effect.scoped(effect))

describe("account device login", () => {
  test("an attempt keeps the device code server-side and hands out only an opaque id", async () => {
    AccountDeviceLogin.reset()
    const attempt = await run(Effect.gen(function* () { return yield* AccountDeviceLogin.start(login()) }))

    expect(attempt.id).toBeString()
    expect(attempt.id.length).toBeGreaterThan(8)
    // Nothing in the wire-facing fields leaks the device code.
    expect(JSON.stringify({ id: attempt.id, interval: attempt.interval })).not.toContain("device-code-abc")

    const found = await run(AccountDeviceLogin.get(attempt.id))
    expect(String(found?.login.code)).toBe("device-code-abc")
    AccountDeviceLogin.reset()
  })

  test("attempts are independent", async () => {
    AccountDeviceLogin.reset()
    const a = await run(Effect.gen(function* () { return yield* AccountDeviceLogin.start(login()) }))
    const b = await run(Effect.gen(function* () { return yield* AccountDeviceLogin.start(login()) }))
    expect(a.id).not.toBe(b.id)

    AccountDeviceLogin.forget(a.id)
    expect(await run(AccountDeviceLogin.get(a.id))).toBeUndefined()
    expect((await run(AccountDeviceLogin.get(b.id)))?.id).toBe(b.id)
    AccountDeviceLogin.reset()
  })

  test("an unknown attempt id is simply absent", async () => {
    AccountDeviceLogin.reset()
    expect(await run(AccountDeviceLogin.get("nope"))).toBeUndefined()
  })

  test("interval comes from the console and is floored at 1ms", async () => {
    AccountDeviceLogin.reset()
    const normal = await run(Effect.gen(function* () { return yield* AccountDeviceLogin.start(login()) }))
    expect(normal.interval).toBe(5000)

    const zero = await run(
      Effect.gen(function* () { return yield* AccountDeviceLogin.start(login({ interval: Duration.zero })) }),
    )
    expect(zero.interval).toBe(1)
    AccountDeviceLogin.reset()
  })

  test("polling cadence only grows when the console asks us to slow down", async () => {
    AccountDeviceLogin.reset()
    const attempt = await run(Effect.gen(function* () { return yield* AccountDeviceLogin.start(login()) }))

    expect(AccountDeviceLogin.nextDelay(attempt, { status: "pending" })).toBe(5000)
    // RFC 8628 section 3.5: +5s on top of the current interval.
    expect(AccountDeviceLogin.nextDelay(attempt, { status: "slow" })).toBe(10000)
    AccountDeviceLogin.reset()
  })

  test("every poll result maps to a client-visible status", () => {
    const attempt = { id: "x", login: login(), deadline: 0, interval: 5000 }
    const cases: Array<[PollResult, AccountDeviceLogin.Outcome["status"]]> = [
      [new PollSuccess({ email: "a@b.c" }), "success"],
      [new PollPending(), "pending"],
      [new PollSlow(), "slow"],
      [new PollExpired(), "expired"],
      [new PollDenied(), "denied"],
    ]
    for (const [result, status] of cases) {
      expect(AccountDeviceLogin.interpret(attempt, result).status).toBe(status)
    }
    const errored = AccountDeviceLogin.interpret(attempt, new PollError({ cause: new Error("boom") }))
    expect(errored).toEqual({ status: "error", message: "boom" })
  })

  test("terminal statuses end the attempt, pending ones do not", () => {
    const terminal = (status: AccountDeviceLogin.Outcome["status"]) => AccountDeviceLogin.isTerminal({ status } as AccountDeviceLogin.Outcome)
    expect(terminal("success")).toBe(true)
    expect(terminal("expired")).toBe(true)
    expect(terminal("denied")).toBe(true)
    expect(terminal("pending")).toBe(false)
    expect(terminal("slow")).toBe(false)
    // An error is not terminal: the next poll may well succeed.
    expect(terminal("error")).toBe(false)
  })
})
