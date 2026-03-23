# Phase 3 - Step 4: Final Verification — CRUD + RBAC Scoping End-to-End

## Why Are We Doing This?

Steps 1–3 built three modules independently. Step 4 proves they work together as a system.

Before moving to Phase 4 (Frontend), we need to confirm:

1. **Teams CRUD** works — create, read, update, delete with correct role access
2. **Employees CRUD** works — all 9 fields validated, team relationship correct
3. **Analytics** computes correctly — averages, distributions, risk indicators all produce valid numbers
4. **RBAC scoping is airtight** — TEAM_MANAGER cannot see/modify data outside their assigned teams
5. **Audit trail captures Phase 3 mutations** — creating teams, updating employees, etc. all logged
6. **Everything from Phase 2 still works** — auth, login, profile, global guards intact

If any of these fail, the frontend and AI pipeline would be built on broken APIs.

---

## The Complete API Surface After Phase 3

```
PUBLIC (no token):
  POST /auth/register
  POST /auth/login

AUTHENTICATED (any role):
  GET  /auth/profile
  GET  /teams                      ← TEAM_MANAGER scoped
  GET  /teams/:id                  ← TEAM_MANAGER scoped
  GET  /employees                  ← TEAM_MANAGER scoped
  GET  /employees?teamId=:id       ← TEAM_MANAGER scoped
  GET  /employees/:id              ← TEAM_MANAGER scoped
  GET  /analytics/team/:teamId     ← TEAM_MANAGER scoped

HR_MANAGER + ADMIN:
  POST   /teams
  PATCH  /teams/:id
  POST   /employees
  PATCH  /employees/:id
  DELETE /employees/:id
  GET    /audit-logs

ADMIN + HR_MANAGER + TEAM_MANAGER:
  PATCH  /teams/:id                ← TEAM_MANAGER scoped to assigned teams
  POST   /employees                ← TEAM_MANAGER scoped to assigned teams
  PATCH  /employees/:id            ← TEAM_MANAGER scoped to assigned teams

ADMIN ONLY:
  GET    /users
  GET    /users/:id
  PATCH  /users/:id/role
  POST   /users/:id/assign-teams
  DELETE /users/:id
  DELETE /teams/:id
```

---

## The Steps

### Step A: Login as all 4 roles

Run the 4 login requests in `verify-phase3.http`. Copy each `access_token` (no quotes) into the `@...Token` variables at the top.

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@hrinsight.com | Password123! |
| HR_MANAGER | hr.manager@hrinsight.com | Password123! |
| TEAM_MANAGER | team.manager@hrinsight.com | Password123! |
| VIEWER | viewer@hrinsight.com | Password123! |

---

### Step B: Verify TEAM_MANAGER scoping on Teams

This is the most critical test. The TEAM_MANAGER should only see teams they're assigned to.

1. **ADMIN**: `GET /teams` → returns all 3 teams
2. **TEAM_MANAGER**: `GET /teams` → returns only 1 team (Platform Engineering)
3. **TEAM_MANAGER**: `GET /teams/:otherTeamId` → 403 Forbidden

If tests 2 or 3 fail, check `teams.service.ts` — the `findAll` WHERE clause should filter by `teamAssignments.some({ userId })`.

---

### Step C: Verify TEAM_MANAGER scoping on Employees

1. **ADMIN**: `GET /employees` → returns all 60 employees
2. **TEAM_MANAGER**: `GET /employees` → returns only ~20 employees (Platform Engineering team)
3. **TEAM_MANAGER**: `POST /employees` with another team's `teamId` → 403
4. **TEAM_MANAGER**: `DELETE /employees/:id` → 403 (not allowed regardless)

---

### Step D: Verify TEAM_MANAGER scoping on Analytics

1. **TEAM_MANAGER**: `GET /analytics/team/:assignedTeamId` → 200 with full analytics
2. **TEAM_MANAGER**: `GET /analytics/team/:otherTeamId` → 403 Forbidden

---

### Step E: Verify Analytics correctness

Run `GET /analytics/team/:teamId` with the ADMIN token and check the math:

1. `employeeCount` matches the number from `GET /employees?teamId=:id`
2. `distributions.engagement.low + medium + high === employeeCount`
3. `distributions.performance.low + medium + high === employeeCount`
4. All `riskIndicators` are between 0 and 100
5. `averages.engagementScore` is between 1 and 5
6. `averages.performanceScore` is between 1 and 5
7. `averages.salary` > 0

---

### Step F: Verify VIEWER is read-only

1. **VIEWER**: `GET /teams` → 200 (can read)
2. **VIEWER**: `POST /teams` → 403 (cannot create)
3. **VIEWER**: `PATCH /employees/:id` → 403 (cannot update)
4. **VIEWER**: `GET /analytics/team/:id` → 200 (can read analytics)

---

### Step G: Verify audit trail captures Phase 3 actions

1. As ADMIN, create a team: `POST /teams`
2. As ADMIN, create an employee: `POST /employees`
3. As ADMIN, update the employee: `PATCH /employees/:id`
4. Check `GET /audit-logs` — you should see 3 new entries:
   - CREATE / TEAM
   - CREATE / EMPLOYEE
   - UPDATE / EMPLOYEE

Each entry should have `userId` (who did it), `metadata.requestBody` (what they sent), `ipAddress`, and `createdAt`.

---

## How to Verify It Worked

Start the backend:

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

Use **`backend/test-requests/verify-phase3.http`** — open in VS Code and click **Send Request** on each block.

---

## Checklist — Phase 3 Complete

**Teams CRUD:**
- [ ] GET /teams with ADMIN → all teams with `_count.employees`
- [ ] GET /teams with TEAM_MANAGER → only assigned teams
- [ ] GET /teams/:id with TEAM_MANAGER (not assigned) → 403
- [ ] POST /teams with HR_MANAGER → 201
- [ ] POST /teams with VIEWER → 403
- [ ] DELETE /teams/:id with ADMIN → 200

**Employees CRUD:**
- [ ] GET /employees with ADMIN → all 60 employees with team info
- [ ] GET /employees?teamId= with ADMIN → filtered by team
- [ ] GET /employees with TEAM_MANAGER → only employees in assigned team
- [ ] POST /employees with TEAM_MANAGER (other team) → 403
- [ ] DELETE /employees/:id with TEAM_MANAGER → 403
- [ ] POST with invalid scores (engagement: 6) → 400 validation error

**Analytics:**
- [ ] GET /analytics/team/:id with ADMIN → 200 with all fields
- [ ] `distributions` sums match `employeeCount`
- [ ] `riskIndicators` are all 0–100
- [ ] GET with TEAM_MANAGER (unassigned team) → 403
- [ ] GET with non-existent teamId → 404

**Cross-cutting:**
- [ ] Auth still works (register, login, profile)
- [ ] Audit logs show Phase 3 mutations
- [ ] VIEWER is read-only on all Phase 3 endpoints

---

## Phase 3 Complete!

If all checklist items pass, Phase 3 is done. You've built:

- **TeamsModule** — full CRUD with RBAC scoping for TEAM_MANAGER
- **EmployeesModule** — full CRUD with 9-field validation and team-level scoping
- **AnalyticsModule** — real-time team metrics: averages, distributions, risk indicators
- **RBAC scoping pattern** — same endpoint, different data based on role + team assignments

**What's next: Phase 4 — Frontend Setup (Next.js + Ant Design)**

This is where the data gets a face. We'll build the login page, dashboard with team cards, employee tables, and analytics charts — all connected to the APIs from Phases 2 and 3.
