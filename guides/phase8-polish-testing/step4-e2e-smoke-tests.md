# Phase 8 - Step 4: End-to-End Smoke Tests — All 4 Roles

## Why Are We Doing This?

This is the **final quality gate** before the project is considered complete through Phase 8. A smoke test verifies the critical paths work — it's not exhaustive automated testing, but a structured manual walkthrough that proves the system works as a whole.

Each role gets tested independently because RBAC means each role experiences a fundamentally different app — different menu items, different buttons visible, different data returned.

---

## Prerequisites

1. Backend running on port 4000 with seeded data
2. Frontend running on port 3001
3. 4 test accounts available (from seed):

| Email | Password | Role |
|-------|----------|------|
| admin@hrinsight.com | Password123! | ADMIN |
| hr.manager@hrinsight.com | Password123! | HR_MANAGER |
| team.manager@hrinsight.com | Password123! | TEAM_MANAGER |
| viewer@hrinsight.com | Password123! | VIEWER |

---

## Test Execution

### ADMIN Smoke Test (Full Access)

```
[ ] Login → redirected to /dashboard
[ ] Sidebar: 5 items visible (Dashboard, Teams, Reports, Audit Logs, User Management)
[ ] Dashboard → select a team → analytics cards load
    [ ] 6 metric cards (Employees, Salary, Engagement, Performance, Overtime, Tenure)
    [ ] Distribution tags (low + medium + high = employee count)
    [ ] Risk indicator bars (color-coded)
[ ] Teams → 3 teams visible with employee counts
    [ ] Create team "Smoke Test Team" in "QA" department → appears in table
    [ ] Edit "Smoke Test Team" → change department to "Testing" → updated
    [ ] Click "Smoke Test Team" → detail page with 0 employees
    [ ] Add employee with all 9 fields → appears in table
    [ ] Edit employee → change engagement to 4.5 → updated
    [ ] Delete employee → removed from table
    [ ] Go back → Delete "Smoke Test Team" → removed
[ ] Reports → list shows existing reports (or empty state)
[ ] Audit Logs → entries visible from the actions above
    [ ] Filter by CREATE → only CREATE entries
    [ ] Filter by TEAM entity → only team-related
    [ ] Pagination works (if > 20 entries)
[ ] Logout → redirected to /login, localStorage cleared
[ ] Navigate to /dashboard directly → redirected to /login
```

### HR_MANAGER Smoke Test

```
[ ] Login → redirected to /dashboard
[ ] Sidebar: 4 items (no User Management)
[ ] Teams → all 3 teams visible
    [ ] Create team button visible and functional
    [ ] Edit button visible on each team
    [ ] NO delete button visible
[ ] Team detail → employees visible
    [ ] Add Employee button visible
    [ ] Edit button on each employee
    [ ] Delete button on each employee (HR_MANAGER can delete)
[ ] Dashboard → all teams in dropdown
[ ] Audit Logs → accessible, entries visible
[ ] Logout → clean redirect
```

### TEAM_MANAGER Smoke Test

```
[ ] Login → redirected to /dashboard
[ ] Sidebar: 3 items (no Audit Logs, no User Management)
[ ] Teams → only "Platform Engineering" visible (1 team)
    [ ] NO create team button
    [ ] Edit button visible on own team
    [ ] NO delete button
[ ] Team detail ("Platform Engineering") → 20 employees
    [ ] Add Employee button visible
    [ ] Edit buttons visible
    [ ] NO delete buttons (TEAM_MANAGER can't delete)
[ ] Dashboard → only "Platform Engineering" in dropdown
    [ ] Analytics load correctly
[ ] Navigate to /audit-logs → 403 error page or blocked by menu
[ ] Logout → clean redirect
```

### VIEWER Smoke Test

```
[ ] Login → redirected to /dashboard
[ ] Sidebar: 3 items (Dashboard, Teams, Reports)
[ ] Teams → all 3 teams visible (read-only)
    [ ] NO create button
    [ ] NO edit buttons
    [ ] NO delete buttons
[ ] Team detail → employees visible (read-only)
    [ ] NO add employee button
    [ ] NO edit/delete buttons
[ ] Employee detail → data visible, risk timeline section present
[ ] Dashboard → teams available, analytics load
    [ ] NO "Generate Insight" button
[ ] Reports → list visible (read-only, view only)
[ ] Navigate to /audit-logs → 403 page
[ ] Logout → clean redirect
```

---

## Cross-Cutting Tests (Any Role)

```
[ ] Page refresh → user stays logged in (token persists)
[ ] Mobile viewport (375px) → sidebar collapses, no horizontal overflow
[ ] Tablet viewport (768px) → reasonable layout, tables scroll
[ ] Stop backend → "Network Error" notification appears
[ ] Fast navigation between pages → no stale data or flash
[ ] Browser back button → works correctly with Next.js routing
```

---

## Issue Resolution

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Blank page after login | AuthProvider not wrapping content | Check (dashboard)/layout.tsx |
| TEAM_MANAGER sees all teams | RBAC WHERE clause missing | Check teams.service.ts findAll |
| VIEWER sees action buttons | RoleGate not applied | Wrap buttons with RoleGate |
| Audit logs accessible to VIEWER | Missing frontend route guard | Add role check in audit-logs/page.tsx |
| antd style flash (FOUC) | Missing AntdRegistry | Check root layout.tsx |
| 401 on page load | Token expired | Re-login, check JWT_EXPIRATION env |
| Forms don't clear after submit | Missing form.resetFields() | Add to modal onOk handler |

---

## Phase 8 Completion Summary

Once all 4 role smoke tests pass and cross-cutting tests pass:

| Feature | Status |
|---------|--------|
| Global error handling (401, 403, 500, network) | ✅ |
| Loading skeletons on all pages | ✅ |
| Form validation (inline, before submit) | ✅ |
| Frontend RBAC (hide/disable per role) | ✅ |
| Responsive layout (mobile, tablet, desktop) | ✅ |
| Color-coded risk indicators | ✅ |
| ADMIN full-access smoke test | ✅ |
| HR_MANAGER smoke test | ✅ |
| TEAM_MANAGER scoped smoke test | ✅ |
| VIEWER read-only smoke test | ✅ |

**Phase 8 is complete.** The platform is fully functional with a polished UI. Move to Phase 9 for advanced features (ROI calculator, risk heatmap, simulation mode).
