# Auth v2 Implementation — Subagent Task Breakdown

## Subagent A: Backend Core (5 files + migration registration)
**Trigger**: After this file is written, run in parallel with Subagent B

### Files to modify:
1. `packages/db/src/database/migration/20260729000002_add_username_message_count.ts` — NEW migration
2. `packages/db/src/database/migration.gen.ts` — register migration (add import after line 42)
3. `packages/db/src/auth-user/user.ts` — add fields + 3 new methods
4. `packages/api/src/groups/auth.ts` — schemas + profile endpoint
5. `packages/api/src/handlers/auth.ts` — modify register/login/me, add updateProfile handler
6. `packages/api/src/handlers/session.ts` — message limit enforcement

### Instructions:
- Read current source files (already provided in plan)
- Follow `docs/auth-plan-extended.md` exactly for every change
- Import `ForbiddenError` from `../errors` in session.ts
- After all edits, run `bun turbo typecheck` from project root

## Subagent B: Frontend (4 files)
**Trigger**: After this file is written, run in parallel with Subagent A

### Files to modify:
1. `packages/app/src/utils/auth-client.ts` — add fields, updateProfile, getMessageCount
2. `packages/app/src/context/auth.tsx` — add messageCount, polling, updateProfile
3. `packages/app/src/pages/login.tsx` — verify-email overlay
4. `packages/app/src/pages/register.tsx` — optional username field

### Instructions:
- Read current source files (already provided in plan)
- Follow `docs/auth-plan-extended.md` exactly for every change
- Match backend schema exactly: `username`, `message_count`, `verified` (boolean)
- After all edits, run `bun turbo typecheck` from project root

## Subagent C: Tests (1 file)
**Dependency**: Must run AFTER Subagent A completes (backend changes needed for test layer)

### File to create:
1. `packages/server/test/auth/auth-extended.test.ts` — NEW test file

### Instructions:
- Follow `docs/auth-plan-extended.md` File 10 exactly
- Use `testEffect` + `Layer.mergeAll` pattern from existing `auth.test.ts`
- Test all: register with/without username, login (unverified passes), updateProfile, message count increments, limit condition, JWT round-trip
- After writing, run `bun test packages/server/test/auth/auth-extended.test.ts` on port 5000
