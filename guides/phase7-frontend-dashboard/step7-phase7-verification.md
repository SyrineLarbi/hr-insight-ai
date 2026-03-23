# Phase 7 - Step 7: Phase 7 Verification — Full UI Walkthrough

## Why Are We Doing This?

Before moving to Phase 8 (Polish), we need to verify that every page works end-to-end with every role. This step is a structured test plan — walk through each feature as each role and confirm correct behavior.

---

## Prerequisites

1. Backend running: `cd backend && npm run start:dev` (port 4000)
2. Frontend running: `cd frontend && npm run dev` (port 3001)
3. Database seeded (4 users, 3 teams, 60 employees)

---

## Test Plan

### Test 1: ADMIN Role (full access)

Login: `admin@hrinsight.com` / `Password123!`

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Login | Redirected to /dashboard, sidebar shows 5 items |
| 2 | Dashboard: select team | Analytics load (metrics, distributions, risk bars) |
| 3 | Dashboard: risk bars | Color-coded (green <30%, amber 30-50%, red >50%) |
| 4 | Dashboard: distributions | low + medium + high = employee count |
| 5 | Teams: view list | 3 teams visible with employee counts |
| 6 | Teams: create team | Modal opens, submit creates team, table updates |
| 7 | Teams: edit team | Pre-filled modal, submit updates team |
| 8 | Teams: delete team | Confirmation popup, team removed |
| 9 | Team detail: employee list | Click team name → see employees sorted by name |
| 10 | Team detail: add employee | Fill all 9 fields → employee appears |
| 11 | Team detail: edit employee | Update engagement score → value changes |
| 12 | Team detail: delete employee | Confirmation → employee removed |
| 13 | Employee detail | Click employee name → see all fields + risk timeline |
| 14 | Reports: list | Shows reports (empty if Phase 6 not done) |
| 15 | Audit logs: view | Shows mutation entries with user/action/entity |
| 16 | Audit logs: filter | Filter by CREATE → only CREATE entries |
| 17 | Audit logs: pagination | Change page → new entries load |
| 18 | Header: logout | Redirect to login, localStorage cleared |

### Test 2: HR_MANAGER Role

Login: `hr.manager@hrinsight.com` / `Password123!`

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Sidebar | 4 items (no User Management) |
| 2 | Teams: all visible | All 3 teams shown |
| 3 | Teams: can create | Create button visible, modal works |
| 4 | Teams: cannot delete | No delete button |
| 5 | Employees: can create/edit | Buttons visible |
| 6 | Employees: can delete | Delete button visible |
| 7 | Audit logs | Accessible and functional |

### Test 3: TEAM_MANAGER Role

Login: `team.manager@hrinsight.com` / `Password123!`

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Sidebar | 3 items (no Audit Logs, no User Management) |
| 2 | Teams: scoped | Only "Platform Engineering" visible |
| 3 | Teams: cannot create | No create button |
| 4 | Teams: can edit own team | Edit button visible |
| 5 | Team detail: can add employee | Add Employee button visible |
| 6 | Team detail: cannot delete | No delete buttons |
| 7 | Dashboard: select team | Only assigned team in dropdown |

### Test 4: VIEWER Role

Login: `viewer@hrinsight.com` / `Password123!`

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Sidebar | 3 items |
| 2 | Teams: all visible | All 3 teams shown (read-only) |
| 3 | Teams: no create/edit/delete | No action buttons at all |
| 4 | Team detail: no actions | View employees but no add/edit/delete |
| 5 | Dashboard: no generate button | Generate button hidden |
| 6 | Audit logs URL | If typed manually → 403 from API |

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Blank page after login | AuthContext not loaded | Check `(dashboard)/layout.tsx` wraps with AuthProvider |
| antd styles flash on load | Missing AntdRegistry | Check `layout.tsx` wraps with `<AntdRegistry>` |
| 401 on every API call | Token not attached | Check `api.ts` interceptor reads localStorage |
| TEAM_MANAGER sees all teams | WHERE clause not applied | Check `teams.service.ts` RBAC logic |
| Sidebar doesn't highlight current page | pathname mismatch | Check `sidebar-menu.tsx` selectedKey logic |
| Modal form doesn't reset | Missing `form.resetFields()` | Add to modal onCancel handler |

---

## Phase 7 Summary

Once all 4 role tests pass:

| Component | Status |
|-----------|--------|
| Project setup + antd config | ✅ |
| Auth pages (login + register) | ✅ |
| Auth context (useAuth hook) | ✅ |
| Dashboard layout (sidebar + header) | ✅ |
| Role-based menu rendering | ✅ |
| Dashboard (team analytics) | ✅ |
| Teams CRUD (table + modals) | ✅ |
| Employee CRUD (table + modals) | ✅ |
| Employee detail + risk timeline | ✅ |
| Reports list + detail | ✅ |
| Audit logs (filtered + paginated) | ✅ |

**Phase 7 is complete.** Move to Phase 8 for polish.
