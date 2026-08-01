# Auth System v2 — Exhaustive Implementation Spec

## Overview

This plan extends the existing auth system with:
1. **Optional username** during registration
2. **Remove login verified check** — unverified users can log in
3. **Message limit** — unverified users get 10 free prompts
4. **Profile management** — PATCH `/api/auth/profile` for username/email/password
5. **Verification polling** — frontend polls `/api/auth/me` while unverified
6. **Frontend verify-email overlay** — shown after login when unverified
7. **Comprehensive tests** — every endpoint, every edge case

---

## File 1: Migration — Add username + message_count columns

**File**: `packages/db/src/database/migration/20260729000002_add_username_message_count.ts`

### Schema Change (ANSI SQL, raw SQL in migration)

```sql
-- Add columns to `user` table
ALTER TABLE `user` ADD COLUMN `username` text NOT NULL DEFAULT '';
ALTER TABLE `user` ADD COLUMN `message_count` integer NOT NULL DEFAULT 0;
```

### Migration File Structure

```typescript
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260729000002_add_username_message_count",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`user\` ADD COLUMN \`username\` text NOT NULL DEFAULT '';`)
      yield* tx.run(`ALTER TABLE \`user\` ADD COLUMN \`message_count\` integer NOT NULL DEFAULT 0;`)
    })
  },
} satisfies DatabaseMigration.Migration
```

### Registration in migration.gen.ts

Add to `/home/aboood/Documents/Projects/DiveeOI/packages/db/src/database/migration.gen.ts`:
- Insert a new dynamic import line after line 42 (after the existing user migration):
  ```typescript
  import("./migration/20260729000002_add_username_message_count"),
  ```

### Edge Cases
- Running on fresh DB: safe, columns are added with defaults
- Re-running on existing DB: SQLite ignores `ALTER TABLE ADD COLUMN IF NOT EXISTS` pattern, will error — but our migration framework tracks which IDs have been run, so it only runs once
- Existing rows: `username` = `''`, `message_count` = `0` — correct defaults

---

## File 2: UserService — Add fields + new methods

**File**: `packages/db/src/auth-user/user.ts`

### User Interface — Add fields

```typescript
export interface User {
  id: string
  email: string
  username: string          // NEW — was missing
  password_hash: string
  role: string
  verified: number
  message_count: number     // NEW — was missing
  created_at: number
  updated_at: number
}
```

### Interface — Add new methods

Add to the `Interface` type:

```typescript
export interface Interface {
  readonly create: (email: string, passwordHash: string, role?: string, username?: string) => Effect.Effect<User>
  readonly findByEmail: (email: string) => Effect.Effect<Option.Option<User>>
  readonly findById: (id: string) => Effect.Effect<Option.Option<User>>
  readonly verifyEmail: (userId: string) => Effect.Effect<void>
  readonly setPasswordHash: (userId: string, hash: string) => Effect.Effect<void>
  readonly createVerificationToken: (userId: string, type: "verify_email" | "password_reset", expiresAt: number) => Effect.Effect<string>
  readonly consumeVerificationToken: (token: string, type: "verify_email" | "password_reset") => Effect.Effect<Option.Option<string>>
  readonly countByRole: (role: string) => Effect.Effect<number>
  readonly hashPassword: (password: string) => Effect.Effect<string>
  readonly verifyPassword: (password: string, hash: string) => Effect.Effect<boolean>
  // NEW methods below:
  readonly updateProfile: (userId: string, data: { username?: string; email?: string; password_hash?: string }) => Effect.Effect<User>
  readonly getMessageCount: (userId: string) => Effect.Effect<number>
  readonly incrementMessageCount: (userId: string) => Effect.Effect<void>
}
```

### `create` — Add optional username parameter

Change from:
```typescript
create: (email: string, passwordHash: string, role = "user") =>
```
To:
```typescript
create: (email: string, passwordHash: string, role = "user", username = "") =>
```

Change insert SQL from:
```sql
INSERT INTO "user" (id, email, password_hash, role, verified, created_at, updated_at)
VALUES (...)
```
To:
```sql
INSERT INTO "user" (id, email, password_hash, role, verified, message_count, username, created_at, updated_at)
VALUES (${id}, ${email}, ${passwordHash}, ${role}, 0, 0, ${username}, ${now}, ${now})
```

Return object add `username` and `message_count`:
```typescript
return { id, email, username, password_hash: passwordHash, role, verified: 0, message_count: 0, created_at: now, updated_at: now }
```

### `updateProfile` — New method implementation

```typescript
updateProfile: (userId: string, data: { username?: string; email?: string; password_hash?: string }) =>
  dieOnError(Effect.gen(function* () {
    const sets: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (data.username !== undefined) {
      sets.push(`username = ?${paramIdx++}`)
      params.push(data.username)
    }
    if (data.email !== undefined) {
      sets.push(`email = ?${paramIdx++}`)
      params.push(data.email)
      // Changing email requires re-verification
      sets.push(`verified = 0`)
    }
    if (data.password_hash !== undefined) {
      sets.push(`password_hash = ?${paramIdx++}`)
      params.push(data.password_hash)
    }
    sets.push(`updated_at = ?${paramIdx++}`)
    params.push(Date.now())
    params.push(userId)

    yield* db.run(
      sql`UPDATE "user" SET ${sql.raw(sets.join(", "))} WHERE id = ${userId}`,
    )
    const rows = yield* db.all<User>(sql`SELECT * FROM "user" WHERE id = ${userId} LIMIT 1`)
    return rows[0]
  })),
```

NOTE: The SQL template approach above uses raw SQL interpolation which needs care. Simpler approach with Drizzle-style, but since this file uses raw SQL via `db.run()` and `db.all()`, we should build the SET clause programmatically.

Actual clean implementation:

```typescript
updateProfile: (userId: string, data: { username?: string; email?: string; password_hash?: string }) =>
  dieOnError(Effect.gen(function* () {
    const now = Date.now()
    const setClauses: string[] = []
    const values: any[] = []

    if (data.username !== undefined) {
      setClauses.push(`username = ?`)
      values.push(data.username)
    }
    if (data.email !== undefined) {
      setClauses.push(`email = ?`)
      values.push(data.email)
      setClauses.push(`verified = 0`)
    }
    if (data.password_hash !== undefined) {
      setClauses.push(`password_hash = ?`)
      values.push(data.password_hash)
    }
    setClauses.push(`updated_at = ?`)
    values.push(now)
    values.push(userId)

    yield* db.run(
      sql.raw(`UPDATE "user" SET ${setClauses.join(", ")} WHERE id = ?`, values),
    )
    const rows = yield* db.all<User>(sql`SELECT * FROM "user" WHERE id = ${userId} LIMIT 1`)
    return rows[0]
  })),
```

### `getMessageCount` — New method

```typescript
getMessageCount: (userId: string) =>
  dieOnError(Effect.gen(function* () {
    const result = yield* db.get<{ message_count: number }>(
      sql`SELECT message_count FROM "user" WHERE id = ${userId}`,
    )
    return result?.message_count ?? 0
  })),
```

### `incrementMessageCount` — New method

```typescript
incrementMessageCount: (userId: string) =>
  dieOnError(Effect.gen(function* () {
    const now = Date.now()
    yield* db.run(
      sql`UPDATE "user" SET message_count = message_count + 1, updated_at = ${now} WHERE id = ${userId}`,
    )
  })),
```

### Edge Cases for UserService
- `updateProfile` with empty data object: at least one field must be provided (validated in handler)
- `updateProfile` with username = `""`: explicitly setting to empty string is allowed
- `getMessageCount` for nonexistent user: returns 0 (shouldn't happen if handler validates)
- `incrementMessageCount` for nonexistent user: no-op (SQLite UPDATE with no matching WHERE does nothing)

---

## File 3: AuthGroup — Extend schemas, add profile endpoint

**File**: `packages/api/src/groups/auth.ts`

### Updated Imports

```typescript
import { ConflictError, InvalidRequestError, UnauthorizedError, ForbiddenError } from "../errors"
```

### Updated UserResponse

```typescript
const UserResponse = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  username: Schema.String,
  role: Schema.String,
  verified: Schema.Boolean,
  message_count: Schema.Number,
})
```

### Updated RegisterBody

```typescript
const RegisterBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
  username: Schema.optional(Schema.String),
})
```

### Updated LoginBody (no change)

```typescript
const LoginBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
})
```

### Updated RefreshBody (no change)

```typescript
const RefreshBody = Schema.Struct({
  refreshToken: Schema.String,
})
```

### Updated ResendBody (no change)

```typescript
const ResendBody = Schema.Struct({
  email: Schema.String,
})
```

### Updated TokenQuery (no change)

```typescript
const TokenQuery = Schema.Struct({
  token: Schema.String,
})
```

### Updated LoginResponse (uses updated UserResponse)

```typescript
const LoginResponse = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  user: UserResponse,
})
```

### New Schema: UpdateProfileBody

```typescript
const UpdateProfileBody = Schema.Struct({
  username: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
})
```

Guarantee at least one field is provided — validation is in the handler.

### New Schema: UpdateProfileResponse

```typescript
const UpdateProfileResponse = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    username: Schema.String,
    role: Schema.String,
    verified: Schema.Boolean,
    message_count: Schema.Number,
  }),
})
```

### New Endpoint: PATCH /api/auth/profile

Add to AuthGroup after the existing endpoints:

```typescript
.add(
  HttpApiEndpoint.patch("auth.updateProfile", "/api/auth/profile", {
    payload: UpdateProfileBody,
    success: UpdateProfileResponse,
    error: ConflictError.pipe(Schema.union(InvalidRequestError)),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.auth.updateProfile",
      summary: "Update user profile",
      description: "Update username, email, or password for the authenticated user.",
    }),
  ),
)
```

### Full Updated AuthGroup

The complete group now has these endpoints:

| # | Name | Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|---|
| 1 | auth.register | POST | /api/auth/register | Public | { email, password, username? } | { user } | ConflictError |
| 2 | auth.login | POST | /api/auth/login | Public | { email, password } | { accessToken, refreshToken, user } | UnauthorizedError |
| 3 | auth.refresh | POST | /api/auth/refresh | Public | { refreshToken } | { accessToken, refreshToken, user } | UnauthorizedError |
| 4 | auth.logout | POST | /api/auth/logout | Public | — | { ok: true } | — |
| 5 | auth.me | GET | /api/auth/me | Bearer | — | { user } | UnauthorizedError |
| 6 | auth.verifyEmail | GET | /api/auth/verify-email | Public | ?token= | { ok: true } | InvalidRequestError |
| 7 | auth.resendVerification | POST | /api/auth/resend-verification | Public | { email } | { ok: true } | — |
| **8** | **auth.updateProfile** | **PATCH** | **/api/auth/profile** | **Bearer** | **{ username?, email?, password? }** | **{ user }** | **ConflictError \| InvalidRequestError** |

---

## File 4: AuthHandler — Modify register, login, me; add updateProfile

**File**: `packages/api/src/handlers/auth.ts`

### Updated Imports

```typescript
import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConflictError, InvalidRequestError, UnauthorizedError } from "../errors"
import { JwtAuth } from "../middleware/jwt"
import { MailService } from "@diveeoi/db/mail/mail"
import { UserService } from "@diveeoi/db/auth-user/user"
```

### Handler 1: auth.register — Accept optional username

Change from:
```typescript
.handle("auth.register", Effect.fn(function* (ctx) {
  const { email, password } = ctx.payload
  // ...
  const user = yield* userService.create(email, passwordHash)
  // ...
  return { user: { id: user.id, email: user.email, role: user.role, verified: false } }
}))
```

To:
```typescript
.handle("auth.register", Effect.fn(function* (ctx) {
  const { email, password, username } = ctx.payload
  // Validate: if username provided, must be non-empty string ≤ 30 chars, alphanumeric + underscores + hyphens
  if (username !== undefined && username !== undefined) {
    if (username.length > 30) {
      return yield* new InvalidRequestError({ message: "Username must be 30 characters or fewer", field: "username" })
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return yield* new InvalidRequestError({ message: "Username can only contain letters, numbers, underscores, and hyphens", field: "username" })
    }
  }
  const existing = yield* userService.findByEmail(email)
  if (Option.isSome(existing)) {
    return yield* new ConflictError({ message: "Email already registered", resource: "user" })
  }
  const passwordHash = yield* userService.hashPassword(password)
  const user = yield* userService.create(email, passwordHash, "user", username ?? "")
  const token = yield* userService.createVerificationToken(user.id, "verify_email", Date.now() + 24 * 60 * 60 * 1000)
  yield* mailService.sendVerificationEmail(email, token)
  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      verified: false,
      message_count: user.message_count,
    },
  }
}))
```

### Handler 2: auth.login — Remove verified check

Change the current code that blocks unverified users:

Current line 44-46:
```typescript
if (user.verified === 0) {
  return yield* new UnauthorizedError({ message: "Email not verified" })
}
```

**REMOVE** this block entirely. The response should now include `username` and `message_count`:

```typescript
.handle("auth.login", Effect.fn(function* (ctx) {
  const { email, password } = ctx.payload
  const maybeUser = yield* userService.findByEmail(email)
  if (Option.isNone(maybeUser)) {
    return yield* new UnauthorizedError({ message: "Invalid email or password" })
  }
  const user = maybeUser.value
  const valid = yield* userService.verifyPassword(password, user.password_hash)
  if (!valid) {
    return yield* new UnauthorizedError({ message: "Invalid email or password" })
  }
  const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
  const refreshToken = yield* jwtAuth.signRefreshToken(user.id)
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      verified: user.verified === 1,
      message_count: user.message_count,
    },
  }
}))
```

### Handler 3: auth.refresh — Return username + message_count

Change response to include new fields:

```typescript
.handle("auth.refresh", Effect.fn(function* (ctx) {
  const { refreshToken } = ctx.payload
  const payload = yield* jwtAuth.verifyRefreshToken(refreshToken)
  const maybeUser = yield* userService.findById(payload.sub)
  if (Option.isNone(maybeUser)) {
    return yield* new UnauthorizedError({ message: "User not found" })
  }
  const user = maybeUser.value
  const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
  const newRefreshToken = yield* jwtAuth.signRefreshToken(user.id)
  return {
    accessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      verified: user.verified === 1,
      message_count: user.message_count,
    },
  }
}))
```

### Handler 4: auth.logout — No change

```typescript
.handle("auth.logout", () => Effect.succeed({ ok: true as const }))
```

### Handler 5: auth.me — Return username + message_count

Change response object:

```typescript
.handle("auth.me", Effect.fn(function* (_ctx) {
  const request = yield* HttpServerRequest.HttpServerRequest
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return yield* new UnauthorizedError({ message: "Missing or invalid authorization header" })
  }
  const token = authHeader.slice(7)
  const payload = yield* jwtAuth.verifyAccessToken(token)
  const maybeUser = yield* userService.findById(payload.sub)
  if (Option.isNone(maybeUser)) {
    return yield* new UnauthorizedError({ message: "User not found" })
  }
  const user = maybeUser.value
  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      verified: user.verified === 1,
      message_count: user.message_count,
    },
  }
}))
```

### Handler 6: auth.verifyEmail — No change (response from handler doesn't need new fields)

```typescript
.handle("auth.verifyEmail", Effect.fn(function* (ctx) {
  const { token } = ctx.query
  const maybeUserId = yield* userService.consumeVerificationToken(token, "verify_email")
  if (Option.isNone(maybeUserId)) {
    return yield* new InvalidRequestError({ message: "Invalid or expired verification token" })
  }
  yield* userService.verifyEmail(maybeUserId.value)
  return { ok: true as const }
}))
```

### Handler 7: auth.resendVerification — No change

```typescript
// (unchanged from current)
```

### Handler 8 (NEW): auth.updateProfile

```typescript
.handle("auth.updateProfile", Effect.fn(function* (ctx) {
  const { username, email, password } = ctx.payload

  // Extract user from Bearer token
  const request = yield* HttpServerRequest.HttpServerRequest
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return yield* new UnauthorizedError({ message: "Missing or invalid authorization header" })
  }
  const token = authHeader.slice(7)
  const payload = yield* jwtAuth.verifyAccessToken(token)
  const maybeUser = yield* userService.findById(payload.sub)
  if (Option.isNone(maybeUser)) {
    return yield* new UnauthorizedError({ message: "User not found" })
  }
  const currentUser = maybeUser.value

  // Validate at least one field provided
  if (username === undefined && email === undefined && password === undefined) {
    return yield* new InvalidRequestError({ message: "At least one field (username, email, or password) must be provided" })
  }

  // Validate username format
  if (username !== undefined) {
    if (username.length > 30) {
      return yield* new InvalidRequestError({ message: "Username must be 30 characters or fewer", field: "username" })
    }
    if (!/^[a-zA-Z0-9_-]*$/.test(username)) {
      return yield* new InvalidRequestError({ message: "Username can only contain letters, numbers, underscores, and hyphens", field: "username" })
    }
  }

  // Check email uniqueness if changing
  if (email !== undefined && email !== currentUser.email) {
    const existing = yield* userService.findByEmail(email)
    if (Option.isSome(existing)) {
      return yield* new ConflictError({ message: "Email already in use", resource: "email" })
    }
  }

  // Validate password strength
  if (password !== undefined && password.length < 8) {
    return yield* new InvalidRequestError({ message: "Password must be at least 8 characters", field: "password" })
  }

  // Build update data
  const data: { username?: string; email?: string; password_hash?: string } = {}
  if (username !== undefined) data.username = username
  if (email !== undefined) data.email = email
  if (password !== undefined) {
    data.password_hash = yield* userService.hashPassword(password)
  }

  const updatedUser = yield* userService.updateProfile(currentUser.id, data)
  return {
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      role: updatedUser.role,
      verified: updatedUser.verified === 1,
      message_count: updatedUser.message_count,
    },
  }
}))
```

---

## File 5: SessionHandler — Add message limit enforcement

**File**: `packages/api/src/handlers/session.ts`

### Updated Imports

Add to the import block:
```typescript
import { HttpServerRequest } from "effect/unstable/http"
import { JwtAuth } from "../middleware/jwt"
import { UserService } from "@diveeoi/db/auth-user/user"
import { ForbiddenError } from "../errors"
import { Option } from "effect"
```

### Yield Additional Services

In the `Effect.gen(function* () { ... })` block, add after line 19:
```typescript
const jwtAuth = yield* JwtAuth.Service
const userService = yield* UserService.Service
```

### Modified session.prompt Handler

Change from:
```typescript
.handle(
  "session.prompt",
  Effect.fn(function* (ctx) {
    return {
      data: yield* session
        .prompt({...})
        .pipe(...)
    }
  }),
)
```

To:
```typescript
.handle(
  "session.prompt",
  Effect.fn(function* (ctx) {
    // --- Message limit check (for JWT-authenticated users) ---
    const request = yield* HttpServerRequest.HttpServerRequest
    const authHeader = request.headers.authorization
    let userId: string | null = null

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7)
      const payload = yield* jwtAuth.verifyAccessToken(token).pipe(
        Effect.catchAll(() => Effect.succeed(null as any)),
      )
      if (payload) {
        const maybeUser = yield* userService.findById(payload.sub)
        if (Option.isSome(maybeUser)) {
          const user = maybeUser.value
          userId = user.id
          if (user.verified === 0 && user.message_count >= 10) {
            return yield* new ForbiddenError({
              message: "Message limit reached. Please verify your email to continue using DiveeOI.",
            })
          }
        }
      }
    }
    // --- End message limit check ---

    const result = yield* session
      .prompt({
        sessionID: ctx.params.sessionID,
        id: ctx.payload.id,
        prompt: ctx.payload.prompt,
        delivery: ctx.payload.delivery,
        resume: ctx.payload.resume,
      })
      .pipe(
        Effect.catchTag("Session.NotFoundError", (error) =>
          Effect.fail(
            new SessionNotFoundError({
              sessionID: error.sessionID,
              message: `Session not found: ${error.sessionID}`,
            }),
          ),
        ),
        Effect.catchTag("Session.PromptConflictError", (error) =>
          Effect.fail(
            new ConflictError({
              message: `Prompt message ID conflicts with an existing durable record: ${error.messageID}`,
              resource: error.messageID,
            }),
          ),
        ),
      )

    // --- Increment message count after successful prompt ---
    if (userId) {
      yield* userService.incrementMessageCount(userId).pipe(
        Effect.catchAll(() => Effect.logWarning("Failed to increment message count")),
      )
    }
    // --- End increment ---

    return { data: result }
  }),
)
```

### Edge Cases for Message Limit

| Scenario | Expected Behavior |
|---|---|
| No auth (Basic auth or no token) | Prompt proceeds, no count tracked |
| Valid Bearer, verified user | Prompt proceeds, count incremented |
| Valid Bearer, unverified, count < 10 | Prompt proceeds, count incremented |
| Valid Bearer, unverified, count = 10 | ForbiddenError, count NOT incremented |
| Valid Bearer, unverified, count > 10 | ForbiddenError (shouldn't happen, but defensive) |
| Expired/Invalid Bearer token | treated as no-auth, prompt proceeds, no count tracked |
| incrementMessageCount fails server-side | Warning logged, prompt result still returned to user |

---

## File 6: AuthClient — Add username, updateProfile, messageCount

**File**: `packages/app/src/utils/auth-client.ts`

### Updated RegisterRequest

```typescript
export interface RegisterRequest {
  email: string
  password: string
  username?: string
}
```

### Updated AuthResponse

```typescript
export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    username: string
    role: string
    verified: boolean
    message_count: number
  }
}
```

### Updated UserResponse

```typescript
export interface UserResponse {
  id: string
  email: string
  username: string
  role: string
  verified: boolean
  message_count: number
}
```

### New: UpdateProfileRequest

```typescript
export interface UpdateProfileRequest {
  username?: string
  email?: string
  password?: string
}
```

### New: updateProfile Method

Add to `authApi` object:

```typescript
updateProfile: (accessToken: string, data: UpdateProfileRequest) =>
  apiFetch<{ user: UserResponse }>("/api/auth/profile", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(data),
  }),
```

### New: getMessageCount Method

```typescript
getMessageCount: (accessToken: string) =>
  apiFetch<{ user: UserResponse }>("/api/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((res) => res.user.message_count),
```

---

## File 7: AuthProvider — Add messageCount, polling, updateProfile

**File**: `packages/app/src/context/auth.tsx`

### Updated Interface

```typescript
interface AuthState {
  user: UserResponse | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  messageCount: number  // NEW
}
```

### Updated AuthActions

```typescript
interface AuthActions {
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  register: (email: string, password: string, username?: string) => Promise<void>  // username param added
  refreshAccessToken: () => Promise<string | null>
  updateProfile: (data: { username?: string; email?: string; password?: string }) => Promise<void>  // NEW
}
```

### Signals

Add signal:
```typescript
const [messageCount, setMessageCount] = createSignal(0)
```

### AuthState Update

```typescript
const state: AuthState = {
  get user() { return user() },
  get accessToken() { return accessToken() },
  get isAuthenticated() { return isAuthenticated() },
  get isLoading() { return isLoading() },
  get messageCount() { return messageCount() },  // NEW
}
```

### Actions Update

```typescript
const actions: AuthActions = { login, logout, register, refreshAccessToken, updateProfile }
```

### register — Accept username

```typescript
async function register(email: string, password: string, username?: string): Promise<void> {
  await authApi.register({ email, password, username })
}
```

### login — Set messageCount

```typescript
async function login(email: string, password: string): Promise<void> {
  const result = await authApi.login({ email, password })
  setAccessToken(result.accessToken)
  setUser(result.user)
  setMessageCount(result.user.message_count)
}
```

### onMount — Handle refresh, start polling

```typescript
onMount(async () => {
  try {
    const result = await authApi.refresh()
    setAccessToken(result.accessToken)
    setUser(result.user)
    setMessageCount(result.user.message_count)

    // Start verification polling if unverified
    if (!result.user.verified) {
      startVerificationPolling(result.accessToken)
    }
  } catch {
    setAccessToken(null)
    setUser(null)
  } finally {
    setIsLoading(false)
  }
})
```

### refreshAccessToken — Set messageCount

```typescript
async function refreshAccessToken(): Promise<string | null> {
  try {
    const result = await authApi.refresh()
    setAccessToken(result.accessToken)
    setUser(result.user)
    setMessageCount(result.user.message_count)
    return result.accessToken
  } catch {
    setAccessToken(null)
    setUser(null)
    return null
  }
}
```

### updateProfile — New method

```typescript
async function updateProfile(data: { username?: string; email?: string; password?: string }): Promise<void> {
  const token = accessToken()
  if (!token) throw new Error("Not authenticated")
  const result = await authApi.updateProfile(token, data)
  setUser(result.user)
  setMessageCount(result.user.message_count)
}
```

### Verification Polling — New function

```typescript
// Verification polling: checks GET /api/auth/me every 5s while unverified
let pollingInterval: ReturnType<typeof setInterval> | null = null

function startVerificationPolling(token: string): void {
  if (pollingInterval) return
  pollingInterval = setInterval(async () => {
    try {
      const result = await authApi.me(token)
      if (result.user.verified) {
        setUser(result.user)
        setMessageCount(result.user.message_count)
        stopVerificationPolling()
        // Show success toast (import from toast system)
        // Use showToast from @diveeoi/app/src/utils/toast.tsx
      }
    } catch {
      // Silent fail — polling continues
    }
  }, 5000)
}

function stopVerificationPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}
```

Call `stopVerificationPolling()` in `logout()` to clean up.

### Full Updated Context Type

```typescript
type AuthContextValue = [
  state: AuthState,
  actions: AuthActions & {
    startVerificationPolling: (token: string) => void,
    stopVerificationPolling: () => void,
  },
]
```

---

## File 8: LoginPage — Add verify-email overlay

**File**: `packages/app/src/pages/login.tsx`

### New State

Add after line 12:
```typescript
const [showVerifyOverlay, setShowVerifyOverlay] = createSignal(false)
const [overlayUsername, setOverlayUsername] = createSignal("")
```

### Modified handleSubmit

After successful login, if user is unverified, show overlay instead of navigating:

```typescript
async function handleSubmit(e: Event) {
  e.preventDefault()
  setError("")
  setLoading(true)
  try {
    await login(email(), password())
    const [state] = useAuth()
    if (state.user && !state.user.verified) {
      setOverlayUsername(state.user.username || "")
      setShowVerifyOverlay(true)
    } else {
      navigate("/")
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : "Login failed")
  } finally {
    setLoading(false)
  }
}
```

### Verify-Email Overlay Component

Add a conditional block in the JSX, shown when `showVerifyOverlay()` is true:

```tsx
{
  showVerifyOverlay() && (
    <div style="
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    ">
      <div style="
        width: 100%; max-width: 420px; padding: 32px;
        background: white; border-radius: 8px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      ">
        <h2 style="font-size: 20px; margin: 0 0 8px;">Verify your email</h2>
        <p style="color: #555; margin: 0 0 20px; line-height: 1.5;">
          We sent a verification link to <strong>{email()}</strong>.
          You can also set a display name below.
        </p>

        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 500;">Display name (optional)</label>
          <input
            type="text"
            value={overlayUsername()}
            onInput={(e) => setOverlayUsername(e.currentTarget.value)}
            style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
            placeholder="Your display name"
            maxLength={30}
          />
        </div>

        <div style="color: #38a169; font-size: 14px; margin-bottom: 12px;">
          Checking for verification every 5 seconds...
        </div>

        <div style="margin-top: 16px;">
          <button
            onClick={handleOverlaySkip}
            style="width: 100%; padding: 10px; background: #6b7280; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer;"
          >
            Skip for now (10 free messages)
          </button>
        </div>

        <div style="margin-top: 12px; text-align: center;">
          <button
            onClick={handleResend}
            disabled={resending()}
            style="background: none; border: none; color: #0066ff; cursor: pointer; font-size: 14px; text-decoration: underline;"
          >
            {resending() ? "Sending..." : "Resend verification email"}
          </button>
        </div>
      </div>
    </div>
  )
}
```

### handleOverlaySkip — Save username + navigate

```typescript
async function handleOverlaySkip() {
  // Save username if provided
  if (overlayUsername()) {
    try {
      const [state] = useAuth()
      if (state.accessToken) {
        await authApi.updateProfile(state.accessToken, { username: overlayUsername() })
      }
    } catch {
      // Silent: username is optional
    }
  }
  setShowVerifyOverlay(false)
  navigate("/")
}
```

IMPORTANT: Since `useAuth()` is called in the component body (line 7), we can access `[state]` from there. The overlay skip handler needs the access token. We can get it from the auth context since the component already calls `useAuth()`.

Actually, looking at the current code structure, `const [_, { login }] = useAuth()` only gets actions. I need to also destructure `state`:

```typescript
const [state, { login }] = useAuth()
```

Then use `state.accessToken` in the overlay handler.

---

## File 9: RegisterPage — Add optional username field

**File**: `packages/app/src/pages/register.tsx`

### Updated imports (add username signal)

```typescript
const [username, setUsername] = createSignal("")
```

### Updated handleSubmit — Pass username to register

```typescript
async function handleSubmit(e: Event) {
  e.preventDefault()
  setError("")

  // Validate username format if provided
  const uname = username().trim()
  if (uname && uname.length > 30) {
    setError("Username must be 30 characters or fewer")
    return
  }
  if (uname && !/^[a-zA-Z0-9_-]+$/.test(uname)) {
    setError("Username can only contain letters, numbers, underscores, and hyphens")
    return
  }

  if (!email().includes("@")) {
    setError("Please enter a valid email address")
    return
  }
  if (password().length < 8) {
    setError("Password must be at least 8 characters")
    return
  }
  if (password() !== confirm()) {
    setError("Passwords do not match")
    return
  }

  setLoading(true)
  try {
    await register(email(), password(), uname || undefined)
    setRegistered(true)
  } catch (err) {
    setError(err instanceof Error ? err.message : "Registration failed")
  } finally {
    setLoading(false)
  }
}
```

### UI — Add username field to form

Insert after the Email field block (after line ~73):

```tsx
<div style="margin-bottom: 16px;">
  <label style="display: block; margin-bottom: 4px; font-weight: 500;">Username (optional)</label>
  <input
    type="text"
    value={username()}
    onInput={(e) => setUsername(e.currentTarget.value)}
    style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
    placeholder="Your display name"
    maxLength={30}
  />
</div>
```

---

## File 10: Test File — Auth Extended Tests

**File**: `packages/server/test/auth/auth-extended.test.ts` (NEW)

### Test Infrastructure

```typescript
import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { UserService } from "@diveeoi/db/auth-user/user"
import { JwtAuth } from "@diveeoi/api/middleware/jwt"
import { testEffect } from "../lib/effect"
import { FetchHttpClient } from "effect/unstable/http"
```

### Test Layer

```typescript
const testLayer = Layer.mergeAll(
  Database.defaultLayer,
  UserService.layer,
  JwtAuth.defaultLayer,
  FetchHttpClient.layer,
)

const it = testEffect(testLayer)
```

### Test Cases

#### 1. Register with optional username
```typescript
it.effect("register creates user with optional username", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("test@example.com", hash, "user", "testuser")
    expect(user).toBeDefined()
    expect(user.email).toBe("test@example.com")
    expect(user.username).toBe("testuser")
    expect(user.verified).toBe(0)
    expect(user.message_count).toBe(0)
  }),
)
```

#### 2. Register without username
```typescript
it.effect("register creates user with empty username when not provided", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("notest@example.com", hash)
    expect(user.username).toBe("")
  }),
)
```

#### 3. Login without verified check
```typescript
it.effect("login succeeds for unverified user", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const jwtAuth = yield* JwtAuth.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("unverified@example.com", hash)

    // Login should succeed (no verified check)
    const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
    const refreshToken = yield* jwtAuth.signRefreshToken(user.id)
    expect(accessToken).toBeTruthy()
    expect(refreshToken).toBeTruthy()
  }),
)
```

#### 4. Login fails for wrong password
```typescript
it.effect("login fails with wrong password", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const valid = yield* userService.verifyPassword("wrongPassword", "someHash")
    expect(valid).toBe(false)
  }),
)
```

#### 5. updateProfile sets username
```typescript
it.effect("updateProfile sets username", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("profile@example.com", hash)
    expect(user.username).toBe("")

    const updated = yield* userService.updateProfile(user.id, { username: "newname" })
    expect(updated.username).toBe("newname")
  }),
)
```

#### 6. updateProfile changes email and resets verified
```typescript
it.effect("updateProfile changes email and resets verified", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("oldemail@example.com", hash)
    yield* userService.verifyEmail(user.id)

    const beforeVerify = yield* userService.findById(user.id)
    expect(beforeVerify).toBeDefined()
    if (Option.isSome(beforeVerify)) {
      expect(beforeVerify.value.verified).toBe(1)
    }

    const updated = yield* userService.updateProfile(user.id, { email: "newemail@example.com" })
    expect(updated.email).toBe("newemail@example.com")
    expect(updated.verified).toBe(0)
  }),
)
```

#### 7. updateProfile changes password
```typescript
it.effect("updateProfile changes password", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("oldPass123")
    const user = yield* userService.create("passchange@example.com", hash)

    const newHash = yield* userService.hashPassword("newPass456")
    const updated = yield* userService.updateProfile(user.id, { password_hash: newHash })

    const validOld = yield* userService.verifyPassword("oldPass123", updated.password_hash)
    const validNew = yield* userService.verifyPassword("newPass456", updated.password_hash)
    expect(validOld).toBe(false)
    expect(validNew).toBe(true)
  }),
)
```

#### 8. incrementMessageCount
```typescript
it.effect("incrementMessageCount increases message count", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("count@example.com", hash)
    expect(user.message_count).toBe(0)

    yield* userService.incrementMessageCount(user.id)
    const count1 = yield* userService.getMessageCount(user.id)
    expect(count1).toBe(1)

    yield* userService.incrementMessageCount(user.id)
    yield* userService.incrementMessageCount(user.id)
    const count3 = yield* userService.getMessageCount(user.id)
    expect(count3).toBe(3)
  }),
)
```

#### 9. getMessageCount returns 0 for new user
```typescript
it.effect("getMessageCount returns 0 for new user", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("newcount@example.com", hash)

    const count = yield* userService.getMessageCount(user.id)
    expect(count).toBe(0)
  }),
)
```

#### 10. JWT token round-trip with user data
```typescript
it.effect("JWT tokens contain userId, email, and role", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const jwtAuth = yield* JwtAuth.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("jwt@example.com", hash)

    const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
    const payload = yield* jwtAuth.verifyAccessToken(accessToken)
    expect(payload.sub).toBe(user.id)
    expect(payload.email).toBe(user.email)
    expect(payload.role).toBe(user.role)
  }),
)
```

#### 11. Session handler message limit (test via handler hooks)

This test requires the full handler stack. For a simpler unit approach, test the business logic:

```typescript
it.effect("unverified user with count >= 10 gets forbidden", () =>
  Effect.gen(function* () {
    const userService = yield* UserService.Service
    const hash = yield* userService.hashPassword("testPass123")
    const user = yield* userService.create("limit@example.com", hash)

    // Simulate 10 messages
    for (let i = 0; i < 10; i++) {
      yield* userService.incrementMessageCount(user.id)
    }

    const count = yield* userService.getMessageCount(user.id)
    expect(count).toBe(10)
    expect(user.verified).toBe(0)

    // The handler would check: if (verified === 0 && message_count >= 10) -> ForbiddenError
    // This is the condition that triggers the limit
    const shouldBlock = user.verified === 0 && count >= 10
    expect(shouldBlock).toBe(true)
  }),
)
```

---

## Dependency Order for Subagents

```
                    ┌─ File 1: Migration (independent)
                    │
                    ├─ File 2: UserService (depends on File 1)
                    │
                    ├─ File 3: AuthGroup schemas (independent)
                    │
                    ├─ File 4: AuthHandler (depends on File 2, File 3)
                    │
Subagent A ──────── ├─ File 5: SessionHandler (depends on File 2)
                    │
                    ├─ File 6: AuthClient (independent, but matches File 3)
                    │
                    ├─ File 7: AuthProvider (depends on File 6)
                    │
                    ├─ File 8: LoginPage (depends on File 6, File 7)
                    │
                    ├─ File 9: RegisterPage (depends on File 7)
                    │
                    └─ File 10: Tests (depends on everything)
```

**Subagent composition:**

- **Subagent A (Backend Core)**: Files 1-5 (migration, UserService, schemas, handlers)
- **Subagent B (Frontend)**: Files 6-9 (auth-client, AuthProvider, LoginPage, RegisterPage)
- **Subagent C (Tests)**: File 10 (test file)

Subagent C depends on Subagent A and B completing first.
Subagents A and B can run in parallel since they work on separate packages.

---

## Verification Checklist

### Backend
- [ ] Migration runs without error: `username` + `message_count` columns exist
- [ ] Register with username creates user with `username` set
- [ ] Register without username creates user with `username = ''`
- [ ] Login succeeds for unverified user (no 401 "Email not verified")
- [ ] Login fails for wrong email/password (401)
- [ ] Login returns `username` and `message_count` in response
- [ ] `GET /api/auth/me` returns `username` and `message_count`
- [ ] `PATCH /api/auth/profile` updates username
- [ ] `PATCH /api/auth/profile` changes email and resets verified
- [ ] `PATCH /api/auth/profile` changes password
- [ ] `PATCH /api/auth/profile` rejects invalid username format
- [ ] `PATCH /api/auth/profile` rejects existing email
- [ ] `PATCH /api/auth/profile` rejects no fields provided
- [ ] Unverified user with 10+ messages gets 403 Forbidden on prompt
- [ ] Unverified user with <10 messages can prompt
- [ ] Verified user always can prompt (any count)
- [ ] Basic auth users can always prompt (no limit)

### Frontend
- [ ] Register page has optional username field
- [ ] After login as unverified: verify-email overlay appears
- [ ] Overlay has username input (pre-filled if set during registration)
- [ ] Overlay has "Skip for now" button
- [ ] "Skip for now" saves username (if provided) and navigates to home
- [ ] Verification polling runs every 5s while unverified
- [ ] When verification detected, polling stops
- [ ] Login page: "Resend verification" link works
- [ ] All success/error states show proper messages

### Typecheck & Tests
- [ ] `bun turbo typecheck` passes in all packages
- [ ] All auth tests pass
- [ ] No existing tests broken
