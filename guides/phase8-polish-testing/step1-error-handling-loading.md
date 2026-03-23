# Phase 8 - Step 1: Error Handling + Loading States

## Why Are We Doing This?

Phase 7 built the functional UI — everything works when the backend responds correctly. But real-world conditions include:
- **Slow connections** — the user sees nothing for 2 seconds, thinks the page is broken
- **API errors** — backend returns 500, the page silently fails
- **Network failures** — WiFi drops, requests timeout
- **Validation errors** — form submission returns field-level errors

Without proper error handling and loading states, the app feels unfinished and unreliable. This step adds:
1. **Global error handler** — catches all API errors and shows antd notifications
2. **Loading skeletons** — antd Skeleton components replace blank areas while data loads
3. **Empty states** — meaningful messages when no data exists

---

## What We're Building

```
frontend/src/
  lib/
    api.ts                    ← MODIFIED: global error notification in response interceptor
  components/
    common/
      page-loading.tsx        ← Full-page skeleton loader
      table-loading.tsx       ← Table skeleton loader
      error-result.tsx        ← Error display component with retry button
```

---

## The Steps

### Step A: Enhance the API client with global error notifications

Update `frontend/src/lib/api.ts` — modify the response interceptor:

```typescript
import axios from 'axios';
import { notification } from 'antd';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data;

    // 401: redirect to login (token expired)
    if (status === 401 && typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    // 403: show access denied notification
    if (status === 403) {
      notification.error({
        message: 'Access Denied',
        description: 'You do not have permission to perform this action.',
      });
    }

    // 500: show server error notification
    if (status && status >= 500) {
      notification.error({
        message: 'Server Error',
        description: 'Something went wrong. Please try again later.',
      });
    }

    // Network error (no response)
    if (!error.response) {
      notification.error({
        message: 'Network Error',
        description: 'Unable to reach the server. Check your connection.',
      });
    }

    return Promise.reject(error);
  },
);

export default api;
```

**Why global notifications instead of per-component error handling?**

Per-component handling means every component needs its own try/catch with its own error message. Global notifications catch the common cases (401, 403, 500, network). Components can still add specific handling for 400 (validation) errors on top.

---

### Step B: Create a PageLoading component

Create `frontend/src/components/common/page-loading.tsx`:

```typescript
'use client';

import { Skeleton, Card, Row, Col, Space } from 'antd';

export default function PageLoading() {
  return (
    <div>
      <Skeleton.Input active style={{ width: 200, marginBottom: 16 }} />
      <Skeleton active paragraph={{ rows: 1 }} style={{ marginBottom: 24 }} />

      <Row gutter={[16, 16]}>
        {[1, 2, 3, 4].map((i) => (
          <Col key={i} xs={24} sm={12} lg={6}>
            <Card>
              <Skeleton active paragraph={{ rows: 2 }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ marginTop: 16 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    </div>
  );
}
```

---

### Step C: Create an ErrorResult component

Create `frontend/src/components/common/error-result.tsx`:

```typescript
'use client';

import { Result, Button } from 'antd';

interface ErrorResultProps {
  status?: '403' | '404' | '500';
  title?: string;
  subtitle?: string;
  onRetry?: () => void;
}

export default function ErrorResult({
  status = '500',
  title = 'Something went wrong',
  subtitle = 'Please try again or contact your administrator.',
  onRetry,
}: ErrorResultProps) {
  return (
    <Result
      status={status}
      title={title}
      subTitle={subtitle}
      extra={
        onRetry ? (
          <Button type="primary" onClick={onRetry}>
            Try Again
          </Button>
        ) : undefined
      }
    />
  );
}
```

---

### Step D: Add loading skeletons to existing pages

For each page that loads data, replace the basic `<Spin>` with skeleton components. Example pattern:

```typescript
// Before (basic spinner):
if (loading) return <Spin size="large" />;

// After (skeleton that matches the page layout):
if (loading) return <PageLoading />;
```

Update these files:
- `(dashboard)/dashboard/page.tsx` — use `PageLoading` while analytics load
- `(dashboard)/teams/page.tsx` — use `Skeleton` rows inside the table area
- `(dashboard)/teams/[id]/page.tsx` — use `PageLoading` while team loads
- `(dashboard)/employees/[id]/page.tsx` — use `PageLoading`
- `(dashboard)/reports/page.tsx` — use table skeleton
- `(dashboard)/audit-logs/page.tsx` — use table skeleton

---

## How to Verify It Worked

1. **Slow connection test**: Open DevTools → Network → Throttle to "Slow 3G". Navigate between pages — see skeletons instead of blank screens.
2. **API error test**: Stop the backend, try loading a page → see "Network Error" notification.
3. **403 test**: Login as VIEWER, manually navigate to `/audit-logs` → see "Access Denied" notification.
4. **Form error test**: Try creating a team with a 1-character name → see validation error message.

---

## Checklist

- [ ] `api.ts` — global error interceptor with notifications (401, 403, 500, network)
- [ ] `page-loading.tsx` — skeleton that mimics page layout
- [ ] `error-result.tsx` — error display with retry button
- [ ] All data-loading pages use skeletons instead of blank/spinner
- [ ] 403 errors show "Access Denied" notification
- [ ] Network errors show "Network Error" notification
- [ ] Server errors (500) show "Server Error" notification

---

Once confirmed, move to **Step 2: Form Validation + Frontend RBAC Enforcement**.
