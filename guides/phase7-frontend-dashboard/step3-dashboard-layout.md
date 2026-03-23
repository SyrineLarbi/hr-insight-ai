# Phase 7 - Step 3: Dashboard Layout — Sidebar, Header, Role-Based Menu

## Why Are We Doing This?

Every dashboard page shares the same shell: a sidebar with navigation, a header showing the user's name and role, and a content area. Without a shared layout:
- Every page would re-render the entire sidebar/header
- Navigation state wouldn't persist across pages
- Role-based menu logic would be duplicated everywhere

We use Next.js's nested layout feature: `(dashboard)/layout.tsx` wraps all dashboard pages with the sidebar/header, while each page only defines its content area.

---

## What We're Building

```
frontend/src/
  components/
    layout/
      app-layout.tsx           ← antd Layout with Sider + Header + Content
      sidebar-menu.tsx         ← Role-based navigation menu
      header-bar.tsx           ← User info + logout button
  app/
    (dashboard)/
      layout.tsx               ← Dashboard layout wrapper (AuthProvider + AppLayout)
      dashboard/page.tsx       ← Placeholder dashboard page
```

---

## The Steps

### Step A: Create the SidebarMenu component

Create `frontend/src/components/layout/sidebar-menu.tsx`:

```typescript
'use client';

import { Menu } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  UserOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AuditOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/types';

interface SidebarMenuProps {
  role: Role | null;
}

export default function SidebarMenu({ role }: SidebarMenuProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Build menu items based on user's role
  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
    },
    {
      key: '/teams',
      icon: <TeamOutlined />,
      label: 'Teams',
    },
    {
      key: '/reports',
      icon: <FileTextOutlined />,
      label: 'Reports',
    },
    // Only ADMIN and HR_MANAGER can see audit logs
    ...(role === 'ADMIN' || role === 'HR_MANAGER'
      ? [
          {
            key: '/audit-logs',
            icon: <AuditOutlined />,
            label: 'Audit Logs',
          },
        ]
      : []),
    // Only ADMIN can manage users
    ...(role === 'ADMIN'
      ? [
          {
            key: '/users',
            icon: <SettingOutlined />,
            label: 'User Management',
          },
        ]
      : []),
  ];

  // Determine which menu item is active based on current URL
  const selectedKey = menuItems.find((item) =>
    pathname.startsWith(item.key),
  )?.key ?? '/dashboard';

  return (
    <Menu
      mode="inline"
      selectedKeys={[selectedKey]}
      items={menuItems}
      onClick={({ key }) => router.push(key)}
      style={{ borderRight: 0 }}
    />
  );
}
```

**Role-based menu rendering:**

| Menu Item | ADMIN | HR_MANAGER | TEAM_MANAGER | VIEWER |
|-----------|-------|------------|--------------|--------|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Teams | ✅ | ✅ | ✅ | ✅ |
| Reports | ✅ | ✅ | ✅ | ✅ |
| Audit Logs | ✅ | ✅ | ❌ | ❌ |
| User Management | ✅ | ❌ | ❌ | ❌ |

---

### Step B: Create the HeaderBar component

Create `frontend/src/components/layout/header-bar.tsx`:

```typescript
'use client';

import { Layout, Space, Typography, Tag, Button, Dropdown } from 'antd';
import { UserOutlined, LogoutOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuth } from '@/contexts/auth-context';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';

const { Header } = Layout;
const { Text } = Typography;

export default function HeaderBar() {
  const { user, role, logout } = useAuth();

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: `${user?.firstName} ${user?.lastName}`,
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign Out',
      danger: true,
      onClick: logout,
    },
  ];

  return (
    <Header
      style={{
        background: '#fff',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <Text strong style={{ fontSize: 16 }}>
        HR Insight AI
      </Text>

      <Space>
        {role && (
          <Tag color={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</Tag>
        )}
        <Dropdown menu={{ items: dropdownItems }} placement="bottomRight">
          <Button type="text" icon={<UserOutlined />}>
            {user?.firstName}
          </Button>
        </Dropdown>
      </Space>
    </Header>
  );
}
```

---

### Step C: Create the AppLayout component

Create `frontend/src/components/layout/app-layout.tsx`:

```typescript
'use client';

import { Layout, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import SidebarMenu from './sidebar-menu';
import HeaderBar from './header-bar';

const { Sider, Content } = Layout;

export default function AppLayout({ children }: { children: ReactNode }) {
  const { loading, role } = useAuth();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
        }}
        breakpoint="lg"
        collapsedWidth={80}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <BarChartOutlined style={{ fontSize: 24, color: '#1677ff' }} />
        </div>
        <SidebarMenu role={role} />
      </Sider>

      <Layout>
        <HeaderBar />
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
```

**Note:** You'll need to add the `BarChartOutlined` import:

```typescript
import { BarChartOutlined } from '@ant-design/icons';
```

---

### Step D: Create the Dashboard layout

Create `frontend/src/app/(dashboard)/layout.tsx`:

```typescript
'use client';

import { ConfigProvider, theme, App } from 'antd';
import { AuthProvider } from '@/contexts/auth-context';
import AppLayout from '@/components/layout/app-layout';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <App>
        <AuthProvider>
          <AppLayout>{children}</AppLayout>
        </AuthProvider>
      </App>
    </ConfigProvider>
  );
}
```

**Why `<App>` wrapper?**

antd v6's `<App>` component provides the `message`, `notification`, and `modal` static methods context. Without it, `message.success()` in our auth context wouldn't render.

---

### Step E: Create a placeholder Dashboard page

Create `frontend/src/app/(dashboard)/dashboard/page.tsx`:

```typescript
'use client';

import { Typography, Card, Row, Col } from 'antd';
import { useAuth } from '@/contexts/auth-context';
import { ROLE_LABELS } from '@/lib/constants';

const { Title, Text } = Typography;

export default function DashboardPage() {
  const { user, role } = useAuth();

  return (
    <div>
      <Title level={3}>Dashboard</Title>
      <Text type="secondary">
        Welcome, {user?.firstName} {user?.lastName}
      </Text>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Text type="secondary">Your Role</Text>
            <Title level={4} style={{ margin: 0 }}>
              {role ? ROLE_LABELS[role] : '—'}
            </Title>
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 24 }}>
        <Text type="secondary">
          The full dashboard with team selector, report generation, and analytics charts will be built in Step 4.
        </Text>
      </Card>
    </div>
  );
}
```

---

## How to Verify It Worked

1. `npm run dev` in frontend
2. Login as `admin@hrinsight.com` → redirects to `/dashboard`
3. Sidebar shows: Dashboard, Teams, Reports, Audit Logs, User Management (ADMIN sees all 5)
4. Header shows: "HR Insight AI" on the left, role tag + user dropdown on the right
5. Click "Sign Out" → redirects to `/login`, localStorage cleared
6. Login as `viewer@hrinsight.com` → sidebar shows only: Dashboard, Teams, Reports (3 items)
7. Login as `hr.manager@hrinsight.com` → sidebar shows 4 items (includes Audit Logs)
8. Sidebar collapses on smaller viewports (`breakpoint="lg"`)

---

## Checklist

- [ ] `sidebar-menu.tsx` — role-based menu items, active route highlighting
- [ ] `header-bar.tsx` — user name, role tag, logout dropdown
- [ ] `app-layout.tsx` — Sider + Header + Content, loading spinner
- [ ] `(dashboard)/layout.tsx` — AuthProvider + ConfigProvider + App wrapper
- [ ] `(dashboard)/dashboard/page.tsx` — placeholder with welcome message
- [ ] ADMIN sees 5 menu items, VIEWER sees 3
- [ ] Sidebar collapses responsively

---

Once confirmed, move to **Step 4: Dashboard Page** — team selector, report generation with WebSocket progress, risk display, executive summary, action plans, and team analytics charts.
