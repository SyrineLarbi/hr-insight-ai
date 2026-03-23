# Phase 2 - Step 4: Final Verification — Test All 4 Roles End-to-End

## Why Are We Doing This?

Steps 1–3 built the pieces. Step 4 proves they actually work together as a system.

Before moving to Phase 3, we need to confirm:

1. **Authentication works** — register, login, JWT validation
2. **Authorization works** — each role gets the right access and nothing more
3. **The global guards fire correctly** — no route is accidentally public
4. **Audit logging captures mutations** — every POST/PATCH/DELETE creates an entry
5. **Profiles return the right data** — TEAM_MANAGER sees assigned teams, ADMIN sees none

If any of these fail, Phase 3 would be built on a broken foundation.

---

## The 4 Roles and What They Can Do

```
ADMIN
  ✅ GET /users          — list all users
  ✅ PATCH /users/:id/role
  ✅ POST /users/:id/assign-teams
  ✅ DELETE /users/:id
  ✅ GET /audit-logs
  ✅ GET /auth/profile
  ✅ GET / (hello world)

HR_MANAGER
  ❌ GET /users          — 403 Forbidden (ADMIN only)
  ✅ GET /audit-logs
  ✅ GET /auth/profile

TEAM_MANAGER
  ❌ GET /users          — 403 Forbidden
  ❌ GET /audit-logs     — 403 Forbidden
  ✅ GET /auth/profile   — shows assignedTeams (non-empty)

VIEWER
  ❌ GET /users          — 403 Forbidden
  ❌ GET /audit-logs     — 403 Forbidden
  ✅ GET /auth/profile   — shows assignedTeams (empty)

UNAUTHENTICATED
  ❌ Everything except /auth/register and /auth/login → 401 Unauthorized
  ✅ POST /auth/register — public
  ✅ POST /auth/login    — public
```

---

## The Steps

### Step A: Get a token for every role

You need 4 tokens — one per role. The seed script already created 4 users. Run these in `backend/test-requests/verify-roles.http`.

**Seeded users (from Phase 1 seed script):**

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@hrinsight.com | Password123! |
| HR_MANAGER | hr.manager@hrinsight.com | Password123! |
| TEAM_MANAGER | team.manager@hrinsight.com | Password123! |
| VIEWER | viewer@hrinsight.com | Password123! |

Login as each one, copy the `access_token`, paste it into the `@...Token` variables at the top of `verify-roles.http`. **No quotes around the token.**

---

### Step B: Run the access matrix tests

The `verify-roles.http` file has 20+ tests organized by scenario. Run them in order:

1. Confirm unauthenticated requests get 401
2. Confirm each role gets correct access (200 or 403) on each route
3. Generate some mutations (create user, update role)
4. Verify audit log captures those mutations

---

### Step C: Check audit log entries

After running mutation tests, call `GET /audit-logs` with the ADMIN token. You should see:

- A `CREATE` entry for `entityType: "USER"` — from the register test
- An `UPDATE` entry for `entityType: "USER"` — from the role-change test
- Each entry has `user` joined (who did it), `metadata` (request body), `ipAddress`, `createdAt`

If audit logs are empty after mutations, the `AuditInterceptor` is not wired up in `app.module.ts`. Check the `APP_INTERCEPTOR` registration.

---

### Step D: Verify TEAM_MANAGER profile shows assigned teams

The seed script assigned the TEAM_MANAGER to "Platform Engineering" team. Login as TEAM_MANAGER and call `GET /auth/profile`. The response should have:

```json
{
  "id": "...",
  "email": "team.manager@hrinsight.com",
  "role": "TEAM_MANAGER",
  "assignedTeams": [
    { "id": "...", "name": "Platform Engineering", "department": "Engineering" }
  ]
}
```

If `assignedTeams` is empty, the seed script's team assignment didn't run. Check `prisma/seed.ts` — it should create a `TeamAssignment` row.

---

### Step E: Verify @Public() works on auth routes

Call `POST /auth/login` and `POST /auth/register` WITHOUT any `Authorization` header. They should return 200/201 (not 401). This confirms:
- The global `JwtAuthGuard` is running
- `@Public()` decorators on those routes are correctly bypassing it

---

## How to Verify It Worked

Use `backend/test-requests/verify-roles.http`. Open in VS Code and click **Send Request** on each block.

**Step-by-step:**
1. Run LOGINS section (4 tests) — paste all 4 tokens at the top
2. Run UNAUTHENTICATED section (2 tests) — expect 401s
3. Run ADMIN section (5 tests) — expect all 200s
4. Run HR_MANAGER section (3 tests) — expect mix of 200 and 403
5. Run TEAM_MANAGER section (3 tests) — expect 403 on /users, 200 on /auth/profile
6. Run VIEWER section (3 tests) — same pattern as TEAM_MANAGER
7. Run MUTATIONS section (3 tests) — create data
8. Run AUDIT VERIFICATION section (2 tests) — confirm mutations appear in audit log

---

## Checklist — Phase 2 Complete

**Authentication:**
- [ ] POST /auth/register (no token) → 201 + access_token
- [ ] POST /auth/login (no token) → 200 + access_token
- [ ] GET /auth/profile (no token) → 401
- [ ] GET /auth/profile (valid token) → 200 + user data

**ADMIN role:**
- [ ] GET /users (ADMIN token) → 200 + array of all users
- [ ] PATCH /users/:id/role (ADMIN token) → 200 + updated user
- [ ] POST /users/:id/assign-teams (ADMIN token) → 200 + user with teamAssignments
- [ ] GET /audit-logs (ADMIN token) → 200 + paginated data

**HR_MANAGER role:**
- [ ] GET /users (HR_MANAGER token) → 403 Forbidden
- [ ] GET /audit-logs (HR_MANAGER token) → 200 (HR_MANAGER CAN see audit logs)

**TEAM_MANAGER role:**
- [ ] GET /users (TEAM_MANAGER token) → 403 Forbidden
- [ ] GET /audit-logs (TEAM_MANAGER token) → 403 Forbidden
- [ ] GET /auth/profile (TEAM_MANAGER token) → 200 + `assignedTeams` non-empty

**VIEWER role:**
- [ ] GET /users (VIEWER token) → 403 Forbidden
- [ ] GET /audit-logs (VIEWER token) → 403 Forbidden
- [ ] GET /auth/profile (VIEWER token) → 200 + `assignedTeams` empty array

**Audit logging:**
- [ ] After a POST mutation → audit-logs shows a CREATE entry
- [ ] After a PATCH mutation → audit-logs shows an UPDATE entry
- [ ] Each audit entry has: `userId`, `action`, `entityType`, `entityId`, `metadata`, `createdAt`
- [ ] Audit entry `user` field is populated (the join works)

---

## Phase 2 Complete!

If all checklist items pass, Phase 2 is done. You've built:

- **JWT authentication** — register, login, protected routes
- **Global guards** — all routes protected by default, `@Public()` opt-out
- **4-tier RBAC** — ADMIN / HR_MANAGER / TEAM_MANAGER / VIEWER roles enforced
- **UsersModule** — ADMIN-only user management and team assignment
- **AuditModule** — automatic mutation logging with filters and pagination

**What's next: Phase 3 — TeamsModule + EmployeesModule + RBAC Scoping**

This is where TEAM_MANAGER scoping becomes real. When a TEAM_MANAGER calls `GET /teams`, they'll only see the teams they're assigned to (via the `team_assignments` table). We'll also build full CRUD for teams and employees with validation DTOs.
