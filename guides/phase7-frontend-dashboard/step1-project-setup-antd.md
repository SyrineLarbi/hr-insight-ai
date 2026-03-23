# Phase 7 - Step 1: Project Setup + Ant Design Configuration

## Why Are We Doing This?

The frontend is still the default Next.js boilerplate — a "To get started, edit page.tsx" splash screen. Before building any pages, we need to:

1. **Configure Ant Design** — wrap the app in `ConfigProvider` with a corporate theme
2. **Set up the API client** — a centralized Axios instance with JWT interceptor
3. **Create the folder structure** — organize by feature for scalability
4. **Clean up boilerplate** — remove the default page, update metadata, clean globals.css

Without this step, every subsequent step would have to fight with missing providers, broken imports, and inconsistent styling.

### Why Ant Design over Tailwind?

Tailwind is installed (came with create-next-app) but we're using **antd as the primary UI library** because:
- Enterprise apps need complex components (Table, Form, DatePicker, Progress, Modal) out of the box
- antd provides consistent design language — every button, input, and modal follows the same pattern
- Building data-heavy dashboards with Tailwind means reimplementing what antd gives for free

We'll keep Tailwind available for utility classes (spacing, flex) but antd handles all components.

---

## What We're Building

```
frontend/src/
  app/
    globals.css              ← MODIFIED: clean up, add antd-compatible styles
    layout.tsx               ← MODIFIED: wrap in ConfigProvider + AuthProvider
    page.tsx                 ← MODIFIED: redirect to /login or /dashboard
  lib/
    api.ts                   ← Axios instance with baseURL + JWT interceptor
    constants.ts             ← API URLs, role labels, risk thresholds
  types/
    index.ts                 ← Shared TypeScript interfaces (User, Team, Employee, etc.)

frontend/.env.local          ← Backend API URL
```

---

## The Steps

### Step A: Create `.env.local`

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

**Why `NEXT_PUBLIC_` prefix?**

Next.js only exposes environment variables to the browser if they start with `NEXT_PUBLIC_`. Without this prefix, the variable is server-side only. Since our API client runs in the browser (client components), it needs browser access.

---

### Step B: Create the folder structure

```bash
mkdir -p /home/syrine/hr-insight-ai/frontend/src/lib
mkdir -p /home/syrine/hr-insight-ai/frontend/src/types
mkdir -p /home/syrine/hr-insight-ai/frontend/src/contexts
mkdir -p /home/syrine/hr-insight-ai/frontend/src/components/layout
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(auth)/login
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(auth)/register
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(dashboard)/dashboard
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(dashboard)/teams
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(dashboard)/teams/[id]
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(dashboard)/employees/[id]
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(dashboard)/reports
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(dashboard)/reports/[id]
mkdir -p /home/syrine/hr-insight-ai/frontend/src/app/(dashboard)/audit-logs
```

**Why route groups `(auth)` and `(dashboard)`?**

Next.js route groups (folders in parentheses) let you apply different layouts to different page sets:
- `(auth)` pages (login, register) → minimal layout, no sidebar, centered form
- `(dashboard)` pages → full layout with sidebar, header, role-based menu

The parentheses don't affect the URL — `/login` stays `/login`, not `/(auth)/login`.

---

### Step C: Create TypeScript interfaces

Create `frontend/src/types/index.ts`:

```typescript
// ─────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────
export type Role = 'ADMIN' | 'HR_MANAGER' | 'TEAM_MANAGER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  createdAt: string;
  teamAssignments?: { team: TeamSummary }[];
  assignedTeams?: TeamSummary[];
}

export interface LoginResponse {
  user: User;
  access_token: string;
}

// ─────────────────────────────────────────────────────────────────────
// Teams
// ─────────────────────────────────────────────────────────────────────
export interface TeamSummary {
  id: string;
  name: string;
  department: string;
}

export interface Team extends TeamSummary {
  createdAt: string;
  updatedAt: string;
  _count?: { employees: number };
  employees?: Employee[];
}

// ─────────────────────────────────────────────────────────────────────
// Employees
// ─────────────────────────────────────────────────────────────────────
export interface Employee {
  id: string;
  teamId: string;
  name: string;
  salary: number;
  tenureMonths: number;
  engagementScore: number;
  performanceScore: number;
  absenteeismDays: number;
  overtimeHours: number;
  lastPromotionMonths: number;
  trainingHours: number;
  createdAt: string;
  updatedAt: string;
  team?: TeamSummary;
  riskSnapshots?: RiskSnapshot[];
}

// ─────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────
export type ReportStatus = 'GENERATING' | 'COMPLETED' | 'FAILED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Report {
  id: string;
  teamId: string;
  generatedBy: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  riskScore: number | null;
  modelVersion: string | null;
  summaryText: string | null;
  status: ReportStatus;
  createdAt: string;
  team?: TeamSummary;
  generatedByUser?: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>;
  actionPlans?: ActionPlan[];
}

export interface ActionPlan {
  id: string;
  reportId: string;
  planJson: Record<string, unknown>;
  projectedRoi: number | null;
  createdAt: string;
}

export interface RiskSnapshot {
  id: string;
  employeeId: string;
  riskScore: number;
  riskLevel: RiskLevel;
  modelVersion: string;
  snapshotDate: string;
}

// ─────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────
export interface TeamAnalytics {
  teamId: string;
  teamName: string;
  department: string;
  employeeCount: number;
  averages: {
    salary: number;
    tenureMonths: number;
    engagementScore: number;
    performanceScore: number;
    absenteeismDays: number;
    overtimeHours: number;
    lastPromotionMonths: number;
    trainingHours: number;
  } | null;
  distributions: {
    engagement: { low: number; medium: number; high: number };
    performance: { low: number; medium: number; high: number };
  } | null;
  riskIndicators: {
    pctHighOvertime: number;
    pctLowEngagement: number;
    pctLowPerformance: number;
    pctLongWithoutPromotion: number;
    pctHighAbsenteeism: number;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────
// Audit Logs
// ─────────────────────────────────────────────────────────────────────
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'GENERATE_REPORT' | 'EXPORT_PDF' | 'LOGIN';

export interface AuditLog {
  id: string;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role'>;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

---

### Step D: Create the API client

Create `frontend/src/lib/api.ts`:

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach JWT from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response interceptor: on 401, clear token and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Don't redirect if we're already on login/register
      const path = window.location.pathname;
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;
```

**Why Axios over fetch?**

- **Interceptors** — automatically attach JWT to every request
- **Automatic JSON parsing** — no `response.json()` boilerplate
- **Error handling** — non-2xx responses throw, making try/catch clean
- **Consistent API** — same in browser and Node.js

**Why localStorage for tokens?**

For this project, `localStorage` is the simplest approach. In production, you'd use `httpOnly` cookies for XSS protection. But since we're using Neon (no custom cookie domain) and this is a portfolio project, `localStorage` + HTTPS is sufficient.

---

### Step E: Create constants

Create `frontend/src/lib/constants.ts`:

```typescript
import type { Role, RiskLevel } from '@/types';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  HR_MANAGER: 'HR Manager',
  TEAM_MANAGER: 'Team Manager',
  VIEWER: 'Viewer',
};

export const ROLE_COLORS: Record<Role, string> = {
  ADMIN: 'red',
  HR_MANAGER: 'purple',
  TEAM_MANAGER: 'blue',
  VIEWER: 'default',
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: '#52c41a',      // green
  MEDIUM: '#faad14',   // amber
  HIGH: '#ff4d4f',     // red
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  LOW: 'Low Risk',
  MEDIUM: 'Medium Risk',
  HIGH: 'High Risk',
};

/** Classify a 0–1 risk score into LOW/MEDIUM/HIGH */
export function getRiskLevel(score: number): RiskLevel {
  if (score < 0.3) return 'LOW';
  if (score < 0.6) return 'MEDIUM';
  return 'HIGH';
}
```

---

### Step F: Clean up globals.css

Replace `frontend/src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --background: #f5f5f5;
  --foreground: #1a1a1a;
}

body {
  background: var(--background);
  color: var(--foreground);
  margin: 0;
}

/* Override antd's default font to match the app */
.ant-layout {
  min-height: 100vh;
}

/* Hide Tailwind's dark mode — we use antd's theme system */
@media (prefers-color-scheme: dark) {
  :root {
    --background: #f5f5f5;
    --foreground: #1a1a1a;
  }
}
```

---

### Step G: Update layout.tsx with Ant Design ConfigProvider

Replace `frontend/src/app/layout.tsx`:

```typescript
import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import './globals.css';

export const metadata: Metadata = {
  title: 'HR Insight AI',
  description: 'Predictive Workforce Analytics Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
```

**Why `@ant-design/nextjs-registry`?**

Ant Design v6 uses CSS-in-JS (via `@ant-design/cssinjs`). Next.js App Router uses server-side rendering by default. Without the registry, antd styles flash on page load (FOUC — Flash Of Unstyled Content) because the CSS-in-JS styles haven't been injected yet.

`@ant-design/nextjs-registry` collects all antd styles during SSR and injects them into the HTML before the browser renders. This eliminates the flash.

**Install it:**

```bash
cd /home/syrine/hr-insight-ai/frontend
npm install @ant-design/nextjs-registry
```

---

### Step H: Update the home page to redirect

Replace `frontend/src/app/page.tsx`:

```typescript
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
```

---

## How to Verify It Worked

```bash
cd /home/syrine/hr-insight-ai/frontend
npm run dev
```

Visit `http://localhost:3001` → should redirect to `/login` (which shows a 404 for now — that's expected, the login page is built in Step 2).

Check the browser console — no errors related to antd or missing providers.

---

## Checklist

- [ ] `.env.local` created with `NEXT_PUBLIC_API_URL=http://localhost:4000`
- [ ] `@ant-design/nextjs-registry` installed
- [ ] `src/types/index.ts` — all interfaces match backend responses
- [ ] `src/lib/api.ts` — Axios with JWT interceptor + 401 redirect
- [ ] `src/lib/constants.ts` — role/risk labels and colors
- [ ] `globals.css` cleaned up
- [ ] `layout.tsx` wraps children in `AntdRegistry`
- [ ] `page.tsx` redirects to `/login`
- [ ] `npm run dev` starts without errors

---

Once confirmed, move to **Step 2: Auth Pages + Auth Context** — login form, register form, and the useAuth hook that manages JWT storage.
