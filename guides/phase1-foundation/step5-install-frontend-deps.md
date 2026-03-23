# Phase 1 - Step 5: Install Frontend Dependencies

## Why Are We Doing This?

Next.js was scaffolded with only its core packages (React, Next.js, TypeScript, ESLint, Tailwind). To build our enterprise dashboard, we need specialized packages for:

- **UI Component Library** — Ant Design (antd) gives us 60+ production-ready components: Tables, Forms, Modals, DatePickers, Progress bars, Menus, Layout — all with consistent styling. Building these from scratch would take months.
- **Icons** — Ant Design's icon library (500+ icons for buttons, navigation, status indicators)
- **Charts** — @ant-design/charts for interactive data visualizations (bar charts, line charts, radar charts, heatmaps)
- **HTTP Client** — Axios for making API calls to the backend
- **Date Handling** — Day.js for date formatting and manipulation (antd uses it internally)
- **Real-time Communication** — Socket.IO client for WebSocket connection (live progress bar)
- **Markdown Rendering** — Display AI-generated executive summaries as formatted text
- **File Downloads** — Save PDF reports to the user's computer

Each package solves a specific problem. Let's go through them.

---

## The Command

```bash
cd /home/syrine/hr-insight-ai/frontend

# UI Component Library
npm install antd @ant-design/icons

# Charts & Visualizations
npm install @ant-design/charts

# HTTP Client (API calls to backend)
npm install axios

# Date handling (antd's date library)
npm install dayjs

# WebSocket client (real-time progress bar)
npm install socket.io-client

# Markdown rendering (for AI-generated summaries)
npm install react-markdown

# File download helper (for PDF exports)
npm install file-saver
npm install -D @types/file-saver
```

You can run them all at once if you prefer:

```bash
cd /home/syrine/hr-insight-ai/frontend

npm install antd @ant-design/icons @ant-design/charts axios dayjs socket.io-client react-markdown file-saver

npm install -D @types/file-saver
```

---

## What Each Package Does (and why you need it)

### UI Library: Ant Design (antd)

| Package | Purpose |
|---------|---------|
| `antd` | **The component library** — 60+ React components designed for enterprise applications |
| `@ant-design/icons` | **Icon library** — 500+ SVG icons (CheckCircleOutlined, TeamOutlined, BarChartOutlined, etc.) |

**Why Ant Design specifically (and not Material UI or Chakra)?**
- **Enterprise-focused**: Antd was built by Alibaba for internal enterprise tools. It handles complex patterns like data-heavy tables, multi-step forms, and role-based navigation out of the box.
- **Complete component set**: Table with sorting/filtering/pagination, DatePicker with range selection, Form with built-in validation, Modal, Drawer, Steps, Progress — everything we need is one import away.
- **Consistent design language**: Every component follows the same visual style. No need to design anything — your app looks professional automatically.
- **TypeScript-first**: Full TypeScript definitions for every component and prop. Your IDE shows exactly what props are available.

**Example — what you'd need to build without antd vs. with antd:**

Without antd (building a sortable data table):
```tsx
// 200+ lines: state management, sort logic, pagination logic,
// filter UI, CSS for headers/rows/hover/active states,
// mobile responsiveness, accessibility (keyboard nav, aria-labels)...
```

With antd:
```tsx
import { Table } from 'antd';

<Table
  dataSource={employees}
  columns={[
    { title: 'Name', dataIndex: 'name', sorter: true },
    { title: 'Risk', dataIndex: 'riskScore', sorter: true },
  ]}
  pagination={{ pageSize: 10 }}
/>
```

That's it. Sorting, pagination, hover states, responsiveness — all handled.

**Components we'll use in this project:**

| Component | Where we'll use it |
|-----------|-------------------|
| `Layout`, `Sider`, `Header`, `Content` | Main app shell with collapsible sidebar |
| `Menu` | Navigation sidebar (items change based on user role) |
| `Table` | Employee lists, team lists, audit logs, reports list |
| `Form`, `Input`, `Select`, `DatePicker` | Login, register, create team, add employee |
| `Modal` | Confirmation dialogs, create/edit forms |
| `Card` | Risk score display, action plan items |
| `Progress` | Risk score circle (color-coded), WebSocket progress bar |
| `Steps` | Report generation progress stages |
| `Tag` | Risk level badges (green/yellow/red), role badges |
| `Descriptions` | Report detail view (key-value display) |
| `Timeline` | Action plan timeline, audit history |
| `Skeleton` | Loading placeholders while data fetches |
| `message`, `notification` | Success/error feedback toasts |
| `Button` | Actions (Generate Insight, Export PDF, Save, Delete) |
| `Statistic` | Dashboard metric cards (total employees, avg risk, etc.) |

### Charts: @ant-design/charts

| Package | Purpose |
|---------|---------|
| `@ant-design/charts` | React chart components that match antd's design language |

**Why @ant-design/charts (and not Chart.js or Recharts)?**
- **Visual consistency**: Charts match antd's style automatically — same colors, fonts, spacing.
- **Built on G2**: Powered by AntV/G2, a grammar-of-graphics engine. More expressive than Chart.js.
- **React-native**: Each chart is a React component with typed props. No canvas manipulation or imperative APIs.

**Charts we'll use:**

| Chart Type | Where |
|-----------|-------|
| `Line` | Employee risk timeline (risk score over time) |
| `Bar` | Team comparison, engagement/performance distributions |
| `Radar` | Team metrics overview (engagement, performance, salary, tenure) |
| `Heatmap` | Risk heatmap across teams (Phase 9 advanced feature) |
| `Gauge` | Overall team risk score |

**Example:**
```tsx
import { Line } from '@ant-design/charts';

<Line
  data={riskHistory}
  xField="date"
  yField="riskScore"
  color="#ff4d4f"
  smooth
/>
```

### HTTP Client: Axios

| Package | Purpose |
|---------|---------|
| `axios` | HTTP client for making API requests to the NestJS backend |

**Why Axios (and not the built-in fetch API)?**
- **Interceptors**: You can add global logic that runs on EVERY request/response. We'll use this for:
  - Automatically attaching the JWT token to every request (`Authorization: Bearer xxx`)
  - Automatically redirecting to login on 401 (token expired)
  - Global error handling (show antd notification on any API error)
- **Request/Response transformation**: Automatic JSON parsing (fetch requires `.json()` call).
- **Timeout support**: Built-in request timeout (fetch doesn't have this natively).
- **Better error handling**: Axios throws on 4xx/5xx status codes. With fetch, you have to manually check `response.ok`.

**How we'll set it up (preview):**
```typescript
// lib/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001', // NestJS backend
  timeout: 30000,
});

// Automatically attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

Every API call in the app will use this `api` instance. The JWT attachment and error handling happen automatically — no need to repeat them in every component.

### Date Handling: Day.js

| Package | Purpose |
|---------|---------|
| `dayjs` | Lightweight date manipulation library (2KB vs Moment.js at 67KB) |

**Why do we need a date library?**
Ant Design's `DatePicker` and `DatePicker.RangePicker` components need a date library to work. Antd v5 uses Day.js by default (earlier versions used Moment.js which is 30x larger).

**What Day.js gives us:**
```typescript
import dayjs from 'dayjs';

// Format dates for display
dayjs('2026-02-17').format('MMM D, YYYY')  // → "Feb 17, 2026"

// Parse date ranges from the DatePicker
const [start, end] = dateRange;
const startISO = start.toISOString();  // → "2026-02-01T00:00:00.000Z"

// Relative time
dayjs('2026-01-15').fromNow()  // → "a month ago"
```

### WebSocket: socket.io-client

| Package | Purpose |
|---------|---------|
| `socket.io-client` | Client-side Socket.IO library for WebSocket connections |

**Why is this needed?**
When the user clicks "Generate Insight", the backend runs a 10-30 second pipeline (fetch data → ML prediction → LLM summary → save). Without WebSocket, the user stares at a spinning wheel with no feedback.

With socket.io-client, the frontend opens a persistent connection and receives progress updates in real-time:

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001/ws/reports', {
  auth: { token: jwt },
});

socket.on('progress', (data) => {
  // data = { percent: 40, message: "Running ML prediction..." }
  setProgress(data.percent);
  setMessage(data.message);
});
```

**Note:** This is the **client** library. We already installed `socket.io` (the **server** library) in the backend (Step 4). They work as a pair — the server emits events, the client listens.

### Markdown Rendering: react-markdown

| Package | Purpose |
|---------|---------|
| `react-markdown` | Renders markdown text as React components |

**Why do we need markdown rendering?**
The LLM (Groq API) generates executive summaries in **markdown format** — with headers, bullet points, bold text, tables. Raw markdown looks like this:

```
## Key Findings
- **High Risk**: Engineering team shows 45% attrition probability
- Employee engagement scores dropped **22%** in Q4
```

`react-markdown` converts this into properly formatted HTML:

```tsx
import ReactMarkdown from 'react-markdown';

<ReactMarkdown>{report.summaryText}</ReactMarkdown>
```

This renders the headers as `<h2>`, bold as `<strong>`, lists as `<ul>` — without any manual parsing.

### File Downloads: file-saver

| Package | Purpose |
|---------|---------|
| `file-saver` | Triggers browser file downloads from JavaScript |

**Why do we need this?**
When the user clicks "Export PDF", the backend returns a PDF file as binary data (a `Blob`). We need to trigger the browser's download dialog. `file-saver` handles this cross-browser:

```typescript
import { saveAs } from 'file-saver';

// When "Export PDF" is clicked:
const response = await api.get(`/reports/${reportId}/pdf`, {
  responseType: 'blob',
});
saveAs(response.data, `report-${reportId}.pdf`);
```

Without `file-saver`, you'd need to create a hidden `<a>` tag, set its href to a Blob URL, click it programmatically, then clean up — and handle browser differences. `file-saver` wraps all of that.

### Dev Dependencies: @types/*

| Package | Purpose |
|---------|---------|
| `@types/file-saver` | TypeScript type definitions for file-saver |

Installed with `-D` because it's only needed during development for TypeScript compilation.

---

## A Note About Tailwind CSS

You'll notice that Tailwind CSS (`tailwindcss`, `@tailwindcss/postcss`) was installed by `create-next-app` during scaffolding. **We're keeping it** even though Ant Design is our primary UI library. Here's why:

- **Antd handles components**: Tables, Forms, Modals, Buttons, Layout — all from antd.
- **Tailwind handles custom spacing/layout**: When you need quick spacing (`mt-4`, `flex`, `gap-2`) or one-off styling that antd doesn't cover, Tailwind utility classes are faster than writing CSS files.
- **They coexist well**: Antd uses CSS-in-JS (cssinjs), Tailwind uses utility classes. No conflicts.

In practice, ~90% of your styling will come from antd components. Tailwind fills the remaining 10% for custom layouts.

---

## How to Verify It Worked

**Step A: Check package.json**

```bash
cd /home/syrine/hr-insight-ai/frontend
cat package.json | grep antd
cat package.json | grep axios
cat package.json | grep socket.io
cat package.json | grep react-markdown
```

Each should return a line showing the package and its version.

**Step B: Make sure the frontend still starts**

```bash
cd /home/syrine/hr-insight-ai/frontend
npm run dev
```

Open your browser and go to **http://localhost:3001**. You should still see the Next.js welcome page. The new packages are installed but not yet imported — so no errors expected.

**Step C: Quick smoke test — verify antd loads**

We'll do a minimal test to confirm antd is working. This is temporary — we'll replace it later when we build the real pages.

Open the file `frontend/src/app/page.tsx` and temporarily replace its content with:

```tsx
'use client';

import { Button, DatePicker, Space, message } from 'antd';
import { SmileOutlined } from '@ant-design/icons';

export default function Home() {
  return (
    <div style={{ padding: 50 }}>
      <h1>Ant Design Test</h1>
      <Space direction="vertical" size="large">
        <Button
          type="primary"
          icon={<SmileOutlined />}
          onClick={() => message.success('antd is working!')}
        >
          Click Me
        </Button>
        <DatePicker />
      </Space>
    </div>
  );
}
```

Refresh the browser at **http://localhost:3001**. You should see:
- A blue "Click Me" button with a smiley icon
- A date picker input field
- Clicking the button shows a green success toast "antd is working!"

If you see all three, antd is correctly installed and configured.

**Step D: Revert the test page**

After confirming antd works, revert `page.tsx` back to its original content (or just leave the test — we'll replace it entirely in Phase 7 anyway).

**Step E: Stop the server** with `Ctrl+C`.

---

## Checklist (confirm before moving to Step 6)

- [ ] All `npm install` commands completed without errors
- [ ] `package.json` contains antd, @ant-design/icons, @ant-design/charts, axios, dayjs, socket.io-client, react-markdown, file-saver
- [ ] `npm run dev` still starts successfully on port 3001
- [ ] antd smoke test works (blue button, date picker, success toast)
- [ ] Server stops cleanly with Ctrl+C

---

Once confirmed, I'll generate **Step 6: Write Prisma Schema (8 Tables)**. That's where we define the entire database structure and connect to Neon PostgreSQL.
