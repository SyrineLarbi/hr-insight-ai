# Phase 8 - Step 2: Form Validation + Frontend RBAC Enforcement

## Why Are We Doing This?

The backend already validates all inputs and enforces RBAC. So why do it on the frontend too?

1. **User experience** — showing "Password must be 8+ characters" before they click submit is faster than waiting for a 400 response. Instant feedback reduces frustration.

2. **Security in depth** — the frontend RBAC is purely cosmetic (hide buttons, disable fields). A determined user can bypass it with DevTools. But it prevents accidental actions by legitimate users. The backend is the real security layer.

3. **Professional feel** — enterprise apps validate inline. Tutorial apps show error after submit. The difference is perceived quality.

---

## What We're Building

This step modifies existing files (no new files):

1. **Enhanced form rules** — all forms get proper antd `rules` arrays with real-time validation
2. **RoleGate component** — utility that conditionally renders children based on user role
3. **Disable/hide patterns** — buttons and menu items respect user permissions

---

## The Steps

### Step A: Create a RoleGate utility component

Create `frontend/src/components/common/role-gate.tsx`:

```typescript
'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import type { Role } from '@/types';

interface RoleGateProps {
  /** Roles that are allowed to see the children */
  allowed: Role[];
  /** What to render if the user's role is not in `allowed`. Default: nothing. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Conditionally renders children based on the user's role.
 *
 * Usage:
 *   <RoleGate allowed={['ADMIN', 'HR_MANAGER']}>
 *     <Button>Delete Team</Button>
 *   </RoleGate>
 *
 * The button only renders for ADMIN and HR_MANAGER.
 * TEAM_MANAGER and VIEWER see nothing (or the fallback).
 */
export default function RoleGate({ allowed, fallback = null, children }: RoleGateProps) {
  const { role } = useAuth();

  if (!role || !allowed.includes(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
```

**Usage examples across the app:**

```typescript
// Show "Create Team" button only for ADMIN/HR_MANAGER
<RoleGate allowed={['ADMIN', 'HR_MANAGER']}>
  <Button type="primary" icon={<PlusOutlined />}>Create Team</Button>
</RoleGate>

// Show "Delete" button only for ADMIN
<RoleGate allowed={['ADMIN']}>
  <Popconfirm title="Delete?"><Button danger>Delete</Button></Popconfirm>
</RoleGate>

// Show disabled message for unauthorized users
<RoleGate allowed={['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER']}
  fallback={<Text type="secondary">Read-only access</Text>}>
  <Button>Generate Report</Button>
</RoleGate>
```

---

### Step B: Enhanced form validation rules

Update all forms to use comprehensive antd validation rules:

**Login form:**
```typescript
<Form.Item
  name="email"
  rules={[
    { required: true, message: 'Email is required' },
    { type: 'email', message: 'Please enter a valid email address' },
  ]}
>
```

**Register form:**
```typescript
<Form.Item
  name="password"
  rules={[
    { required: true, message: 'Password is required' },
    { min: 8, message: 'Password must be at least 8 characters' },
    {
      pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      message: 'Must include uppercase, lowercase, and a number',
    },
  ]}
>
```

**Employee form (team detail page):**
```typescript
<Form.Item
  name="engagementScore"
  label="Engagement (1-5)"
  rules={[
    { required: true, message: 'Engagement score is required' },
    { type: 'number', min: 1, max: 5, message: 'Must be between 1 and 5' },
  ]}
>
  <InputNumber min={1} max={5} step={0.1} style={{ width: 150 }} />
</Form.Item>

<Form.Item
  name="salary"
  label="Salary ($)"
  rules={[
    { required: true, message: 'Salary is required' },
    { type: 'number', min: 1, message: 'Salary must be greater than 0' },
  ]}
>
  <InputNumber
    min={1}
    formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
    parser={(value) => Number(value?.replace(/\$\s?|(,*)/g, '') ?? 0)}
    style={{ width: 180 }}
  />
</Form.Item>
```

---

### Step C: Add protected route behavior

Update `frontend/src/components/layout/app-layout.tsx` to redirect unauthenticated users:

Add this logic inside the `AppLayout` component:

```typescript
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Inside AppLayout component:
const { loading, isAuthenticated } = useAuth();
const router = useRouter();

useEffect(() => {
  if (!loading && !isAuthenticated) {
    router.push('/login');
  }
}, [loading, isAuthenticated, router]);

if (loading || !isAuthenticated) {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" />
    </div>
  );
}
```

This ensures that if someone navigates directly to `/dashboard` without logging in, they get redirected to `/login`.

---

### Step D: Protect the audit-logs route on the frontend

The backend already blocks TEAM_MANAGER/VIEWER from `/audit-logs`, but we should also prevent them from seeing the page at all. Add a guard at the top of `audit-logs/page.tsx`:

```typescript
const { role } = useAuth();

if (role !== 'ADMIN' && role !== 'HR_MANAGER') {
  return <ErrorResult status="403" title="Access Denied" subtitle="Only Admin and HR Manager can view audit logs." />;
}
```

---

## How to Verify It Worked

1. **Form validation**: Try submitting login with empty fields → inline error messages appear before submit
2. **Password rules**: Register with "abc" → "Must be at least 8 characters"
3. **Employee score**: Enter engagement 6 → "Must be between 1 and 5"
4. **RoleGate**: Login as VIEWER → no create/edit/delete buttons visible anywhere
5. **Protected routes**: Clear localStorage, go to `/dashboard` → redirected to `/login`
6. **Audit route guard**: Login as TEAM_MANAGER, navigate to `/audit-logs` → see 403 error page

---

## Checklist

- [ ] `role-gate.tsx` created and used across Teams, Employees, Dashboard pages
- [ ] Login form: email format + required validation
- [ ] Register form: password strength rules (min 8, uppercase, lowercase, digit)
- [ ] Employee forms: score 1-5 range, salary > 0, months >= 0
- [ ] AppLayout redirects to /login if not authenticated
- [ ] Audit logs page shows 403 for non-ADMIN/HR_MANAGER
- [ ] All buttons properly gated by role

---

Once confirmed, move to **Step 3: Visual Polish + Responsive Design**.
