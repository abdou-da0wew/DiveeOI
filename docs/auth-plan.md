# Auth System — Architecture Plan

## 1. CONTEXT & OBJECTIVE

Replace the single-password Basic auth with a full user account system. The server
currently uses `OPENCODE_SERVER_PASSWORD` env var — a single shared secret that all
clients use. This plan builds:

- **User accounts** with email + password (bcrypt hashed)
- **JWT tokens** — short-lived access (15 min, in-memory) + long-lived refresh (7 days,
  httpOnly cookie)
- **Email verification** via Nodemailer + Gmail SMTP
- **Custom login/register UI** (no browser Basic auth dialog)
- **Dual auth mode** — Basic auth AND JWT work side-by-side during migration, controlled
  by `DIVEEOI_AUTH_MODE` env var
- **Role system** — first user is admin, future-ready for subscriptions/public access
- **Backward compat** — `OPENCODE_SERVER_PASSWORD` still works but only when explicitly
  enabled via config

**Success condition:** A user can register, verify email, login, close and reopen the
browser, and the app remembers them (refresh token cookie). All existing functionality
continues to work.

---

## 2. ARCHITECTURE

### Data flow (auth)

```
Browser                     Server
  │                          │
  ├─ POST /api/auth/register ─→ Create user (bcrypt hash, verified=false)
  │                          │   Generate verification token
  │                          │   Send email via Nodemailer
  │                          │
  ├─ GET /api/auth/verify?t=x ─→ Mark user verified
  │                          │
  ├─ POST /api/auth/login ─────→ Validate credentials
  │                          │   Generate access token (15m) + refresh token (7d)
  │   ← { accessToken }      │   Set refresh token as httpOnly cookie
  │                          │
  ├─ POST /api/auth/refresh ───→ Validate refresh cookie
  │   ← { accessToken }      │   Rotate refresh token (new cookie)
  │                          │
  ├─ GET /api/...            │
  │   Authorization: Bearer ──→ JWT middleware validates access token
  │                          │   If valid → proceed
  │                          │   If expired → 401 → frontend calls refresh
```

### Middleware flow

```
Request
  │
  ├─ Is /api/auth/*? → Skip auth, pass through
  │
  ├─ DIVEEOI_AUTH_MODE=jwt (or both):
  │   ├─ Has Bearer token? → Decode JWT, attach user to context
  │   └─ No token? → 401 (unless mode=both, then try Basic)
  │
  ├─ DIVEEOI_AUTH_MODE=basic (or both):
  │   ├─ Has Basic auth? → Validate against OPENCODE_SERVER_PASSWORD
  │   └─ No credential? → 401
  │
  └─ DIVEEOI_AUTH_MODE=disabled → Allow all
```

### Backward compat for OPENCODE_SERVER_PASSWORD

The old `OPENCODE_SERVER_PASSWORD` env var is supported only when
`DIVEEOI_ALLOW_OPENCODE_ENV=true` is set. When enabled, it works the same as
`DIVEEOI_AUTH_MODE=basic` with the old password. This is opt-in only — default is
to use the new `DIVEEOI_` vars exclusively.

### Key technology choices

| Choice | Decision | Why |
|---|---|---|
| JWT library | `jose` | Zero dependencies, works with Bun, Edge-compatible |
| Password hashing | `bcryptjs` | Pure JS, no native deps, works in Termux/Bun |
| Email | `nodemailer` | Native Gmail SMTP, well-maintained |
| Refresh token storage | httpOnly cookie | Not accessible to JS, immune to XSS |
| Token ID | `crypto.randomUUID()` | Built into Node/Bun, no extra dep |

---

## 3. FILE/DIRECTORY STRUCTURE

### Backend (new files marked NEW, modified marked MOD)

```
packages/db/src/
├── database/migration/
│   └── 037_auth_users.ts           NEW — users + verification_tokens tables
├── user/
│   ├── user.ts                     NEW — User service, types
│   └── index.ts                    NEW — barrel
├── mail/
│   ├── mail.ts                     NEW — Mail service (Nodemailer wrapper)
│   └── index.ts                    NEW — barrel

packages/api/src/
├── groups/
│   └── auth.ts                     NEW — AuthGroup (register/login/refresh/me/logout/verify)
├── handlers/
│   └── auth.ts                     NEW — Auth handler implementations
├── middleware/
│   ├── authorization.ts            MOD — Accept both Basic + JWT + AUTH_MODE config
│   └── jwt.ts                      NEW — JWT sign/verify utilities, types
├── api.ts                          MOD — Add AuthGroup before middleware

packages/server/src/
├── server/
│   └── auth-config.ts              NEW — AuthConfig service (reads DIVEEOI_* env vars)
├── main.ts                         MOD — Wire Mail and AuthConfig layers

packages/app/src/
├── pages/
│   ├── login.tsx                   NEW — Login page
│   └── register.tsx                NEW — Registration page
├── context/
│   └── auth.tsx                    NEW — Auth context (token mgmt, user state)
├── app.tsx                         MOD — Add auth routes, login route guard
├── utils/
│   └── auth-client.ts              NEW — API client for auth endpoints
```

---

## 4. DETAILED TODO BREAKDOWN

### `add-user-table` — Add user and verification DB migration

**What:** Create `packages/db/src/database/migration/037_auth_users.ts` with:

- `users` table:
  - `id TEXT PK`
  - `email TEXT UNIQUE NOT NULL`
  - `password_hash TEXT NOT NULL`
  - `role TEXT NOT NULL DEFAULT 'user'`
  - `verified INTEGER NOT NULL DEFAULT 0`
  - `time_created INTEGER NOT NULL`
  - `time_updated INTEGER NOT NULL`
- `verification_tokens` table:
  - `id TEXT PK`
  - `user_id TEXT FK -> users`
  - `token TEXT UNIQUE NOT NULL`
  - `type TEXT NOT NULL` (verify_email, password_reset)
  - `expires_at INTEGER NOT NULL`
  - `used INTEGER NOT NULL DEFAULT 0`
- Index on `users(email)`
- Index on `verification_tokens(token)`

**How:** Follow the existing migration pattern in `schema.gen.ts`. Each operation is
`yield* tx.run(...)`. Register in the migration registry.

**Verify:** Run migration. `users` and `verification_tokens` tables exist in SQLite DB.

**Risk:** LOW.

---

### `implement-user-service` — User service layer

**What:** Create `packages/db/src/user/user.ts` with `User` service (Effect + Drizzle):

- `create(email, password_hash, role?)` → inserts user, returns user
- `findByEmail(email)` → returns user or None
- `findById(id)` → returns user or None
- `verifyEmail(userId)` → sets verified=1
- `setPasswordHash(userId, hash)` → updates password
- `createVerificationToken(userId, type, expiresAt)` → inserts token, returns token string
- `consumeVerificationToken(token, type)` → finds and marks used, returns userId
- `countByRole(role)` → returns count (for first-admin check)

**Verify:** Unit test: create, findByEmail, verifyEmail, confirm verified.

**Risk:** LOW.

---

### `implement-jwt-utils` — JWT sign/verify utilities

**What:** Create `packages/api/src/middleware/jwt.ts`:

- `JwtConfig` service: reads `DIVEEOI_JWT_SECRET` from env
- If `DIVEEOI_JWT_SECRET` is unset: generate random 32-byte hex on first start, write
  to a file (`data/jwt-secret.txt`), and warn. Read from file on subsequent starts.
- `signAccessToken(userId, email)` → JWT string (15 min expiry)
- `signRefreshToken(userId)` → JWT string with `jti` (7 day expiry)
- `verifyAccessToken(token)` → payload or fail
- `verifyRefreshToken(token)` → payload or fail
- Types: `AccessTokenPayload { sub, email, iat, exp }`,
  `RefreshTokenPayload { sub, jti, iat, exp }`

**Verify:** Round-trip sign + verify. Expired token fails. Wrong signature fails.

**Risk:** LOW.

---

### `implement-mail-service` — Mail service (Nodemailer + Gmail SMTP)

**What:** Create `packages/db/src/mail/mail.ts`:

- `MailConfig` service: reads `DIVEEOI_SMTP_HOST`, `DIVEEOI_SMTP_PORT`,
  `DIVEEOI_SMTP_USER`, `DIVEEOI_SMTP_PASS`, `DIVEEOI_SMTP_FROM`, `DIVEEOI_APP_URL`
  from env
- `MailService` class:
  - `sendVerificationEmail(email, token)` → HTML email with verification link
  - `sendEmail(to, subject, html)` → generic send
  - Connection: reusable transporter, verify on init
  - Error handling: 3 retries with backoff, log on permanent failure
- HTML email template for verification (inline CSS)
- Dev mode: if SMTP vars are missing, log emails to console

**Verify:** Call sendVerificationEmail → check inbox or console.

**Risk:** MEDIUM. Gmail SMTP needs app passwords.

---

### `implement-auth-endpoints` — Auth API endpoints

**What:** Create `packages/api/src/groups/auth.ts` + `packages/api/src/handlers/auth.ts`:

| Method | Path | Auth | Body/Params | Returns |
|---|---|---|---|---|
| POST | /api/auth/register | Public | `{ email, password }` | `{ user: { id, email } }` |
| POST | /api/auth/login | Public | `{ email, password }` | `{ accessToken, user }` + refresh cookie |
| POST | /api/auth/refresh | Cookie | (cookie) | `{ accessToken }` + new refresh cookie |
| POST | /api/auth/logout | JWT | — | Clears cookie |
| GET | /api/auth/me | JWT | — | `{ user: { id, email, role, verified } }` |
| GET | /api/auth/verify-email | Public | `?token=` | Success page or JSON |
| POST | /api/auth/resend-verification | Public | `{ email }` | Rate-limited resend |

Validation rules:
- Email: regex validation
- Password: min 8 chars
- Registration: check duplicate email
- Login: check verified status (return 403 with clear message if unverified)

**Verify:** Full register → verify → login → me → refresh → logout flow.

**Risk:** MEDIUM. Auth endpoints must bypass the authorization middleware.

---

### `modify-auth-middleware` — Dual auth middleware

**What:** Modify `packages/api/src/middleware/authorization.ts`:

- Add `DIVEEOI_AUTH_MODE` config (`basic | jwt | both | disabled`), default `both`
- When `mode=jwt` or `both`: extract `Bearer <token>` from `Authorization` header,
  verify JWT, attach user to request context
- When `mode=basic` or `both`: fall back to Basic auth validation against
  `OPENCODE_SERVER_PASSWORD` (only if `DIVEEOI_ALLOW_OPENCODE_ENV=true`)
- Auth endpoints (`/api/auth/`) always pass without auth
- Health endpoint always passes without auth
- No valid credential → 401

**Verify:** With `mode=both`: Basic auth works, Bearer works, no auth → 401.

**Risk:** LOW.

---

### `wire-server-services` — Wire new layers into server bootstrap

**What:**

- `packages/api/src/api.ts` — Add `AuthGroup` BEFORE the `.middleware(Authorization)` call
- `packages/api/src/routes.ts` — Add auth handler to handlers composition
- `packages/server/src/main.ts` — Add `MailService.defaultLayer` and auth config layers

**Verify:** Server starts. Auth endpoints respond.

**Risk:** LOW.

---

### `implement-frontend-auth-context` — Auth context, login/register pages

**What:**

- `packages/app/src/context/auth.tsx`:
  - `AuthProvider` wraps app root, stores: `user`, `accessToken`, `isAuthenticated`,
    `isLoading`
  - On mount: calls `POST /api/auth/refresh` (cookie auto-sent). Valid → store user +
    access token. Fails → not authenticated.
  - `useAuth()` returns `{ user, isAuthenticated, login, logout, register, isLoading }`
  - Auto-refresh: schedule refresh before token expiry
  - Refresh race guard: promise-based mutex, only one refresh at a time

- `packages/app/src/pages/login.tsx`:
  - Email + password form, submit → login → redirect to home
  - Error display (wrong password, unverified, network)
  - Link to register, "Resend verification" link
  - Custom styled, no browser default auth dialog

- `packages/app/src/pages/register.tsx`:
  - Email + password + confirm password
  - Client-side validation
  - Submit → "Check your email" screen
  - Link to login

- `packages/app/src/utils/auth-client.ts`:
  - Thin fetch wrapper for auth endpoints
  - Adds Bearer header from auth context

- `packages/app/src/app.tsx`:
  - Add `/login` and `/register` routes at root level (no server auth needed)
  - `AuthProvider` above `ServerProvider`
  - Route guard: if not authenticated and not on auth pages → redirect to `/login`
  - Auth check happens AFTER server connection but before app renders

**Verify:** Load app without auth → login page. Register → verification notice.
Login → home. Close/reopen browser → auto-authenticated.

**Risk:** MEDIUM. Auth context must integrate with existing provider hierarchy.

---

### `update-sdk-auth` — Wire Bearer token into API calls

**What:** Modify the SDK layer or fetch wrapper to include `Authorization: Bearer <token>`
on all API requests. The `createSdkForServer` utility needs to accept an auth token
getter. Exclude auth endpoints from Bearer injection.

**Verify:** All API calls include Bearer header. Expired token triggers refresh then retry.

**Risk:** MEDIUM.

---

### `full-typecheck-and-smoke-test` — Final verification

**What:**
- `tsc --noEmit` in all packages — 0 errors
- Manual: register → verify → login → close browser → reopen → still logged in
- Manual: Basic auth still works (mode=both + `DIVEEOI_ALLOW_OPENCODE_ENV=true`)
- Manual: unverified email can't login
- Manual: invalid credentials → proper error handling
- Update `PROJECT_LESSONS.md`

**Verify:** CHECKLIST.md gates met.

---

## 5. CRITICAL PATHS & DEPENDENCIES

```
Parallel (can be done simultaneously):
  ├─ add-user-table
  ├─ implement-jwt-utils
  ├─ implement-mail-service
  └─ implement-frontend-auth-context (design/scaffold only)

Serial chain (must be in order):
  1. add-user-table
  2. implement-user-service (depends on 1)
  3. implement-auth-endpoints (depends on 2 + jwt + mail)
  4. modify-auth-middleware (depends on jwt)
  5. wire-server-services (depends on 3 + 4)
  6. update-sdk-auth (depends on jwt + auth-endpoints)
  7. full-typecheck-and-smoke-test (depends on all)

Independent:
  - implement-frontend-auth-context (parallel until final wiring)
```

---

## 6. ENVIRONMENT & CONFIGURATION

### New env vars (DIVEEOI_ prefix)

| Variable | Default | Description |
|---|---|---|
| `DIVEEOI_AUTH_MODE` | `both` | Auth mode: basic, jwt, both, disabled |
| `DIVEEOI_JWT_SECRET` | auto-generated | JWT signing key. Generated on first start, persisted to file |
| `DIVEEOI_SMTP_HOST` | — | SMTP server hostname |
| `DIVEEOI_SMTP_PORT` | 587 | SMTP server port |
| `DIVEEOI_SMTP_USER` | — | SMTP username (Gmail email) |
| `DIVEEOI_SMTP_PASS` | — | SMTP password (Gmail app password) |
| `DIVEEOI_SMTP_FROM` | — | From address for sent emails |
| `DIVEEOI_APP_URL` | `http://localhost:4097` | Public URL for verification links |

### Backward compat opt-in

| Variable | Default | Description |
|---|---|---|
| `DIVEEOI_ALLOW_OPENCODE_ENV` | `false` | When true, reads `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` for Basic auth |

### Existing vars (still work when opt-in enabled)

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_SERVER_PASSWORD` | — | Old shared password (only when opt-in enabled) |
| `OPENCODE_SERVER_USERNAME` | `opencode` | Old username (only when opt-in enabled) |

---

## 7. TESTING STRATEGY

| Layer | What to test | How |
|---|---|---|
| User service | CRUD operations | Effect unit tests with in-memory SQLite |
| JWT utils | sign/verify round-trip, expiry, bad signature | Unit tests |
| Mail service | Basic send, console fallback, error handling | Integration with mock |
| Auth API | Full register → verify → login → me → refresh → logout flow | Integration tests |
| Auth middleware | Bearer, Basic, none, expired | Integration tests |
| Frontend auth | Login/register pages render, redirect works | Manual browser |

**Pass:** `tsc --noEmit` + all tests pass in all packages.

---

## 8. DEPLOYMENT PLAN

1. Pull latest code
2. Run DB migration (new tables, no destructive changes)
3. Set `DIVEEOI_AUTH_MODE=both`, `DIVEEOI_JWT_SECRET`, SMTP vars
4. Restart server
5. Smoke: login page appears, register works, old Basic auth still works

**Rollback:** Set `DIVEEOI_AUTH_MODE=basic`, keep new tables (unused). Everything
reverts to old behavior.

---

## 9. KNOWN RISKS & OPEN QUESTIONS

| Risk | Impact | Mitigation |
|---|---|---|
| Gmail SMTP blocked | HIGH | Support App Passwords. Console fallback. Document setup. |
| JWT secret lost on restart | MEDIUM | Persist auto-generated secret to file. Read on restart. |
| Refresh cookie cross-origin issues | MEDIUM | SameSite=Lax. Document dev config. |
| SDK doesn't support dynamic auth headers | MEDIUM | Fetch interceptor pattern. |
| Refresh race condition | LOW | Promise-based mutex in auth context. |

---

## 10. MINDSET

Build the thinnest working slice end-to-end before expanding. A user who can register,
verify, login, and stay logged in across browser restarts is worth more than perfectly
designed role tables that have never been tested. Defer subscription models, permission
scopes, and admin panels until the core auth loop is verified in production. When
uncertain: do the boring thing (use jose + bcryptjs + nodemailer — no over-engineered
abstractions). Every new env var gets the `DIVEEOI_` prefix from day one. Ship nothing
without a passing typecheck.
