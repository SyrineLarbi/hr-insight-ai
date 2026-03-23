# Phase 7 - Step 2: Auth Pages + Auth Context

## Why Are We Doing This?

Every page in the app needs to know: **is the user logged in? What role are they?** Without a centralized auth system, every page would need to check `localStorage`, parse the JWT, handle expired tokens, and redirect to login — duplicating logic everywhere.

We build three things:
1. **AuthContext + useAuth hook** — a React context that provides `user`, `login()`, `logout()`, `isAuthenticated`, and `role` to every component
2. **Login page** — antd Form with email/password, calls `POST /auth/login`
3. **Register page** — antd Form with all fields, calls `POST /auth/register`

The auth context wraps the entire `(dashboard)` layout, so any component can call `const { user, logout } = useAuth()` without prop drilling.

---

## What We're Building

```
frontend/src/
  contexts/
    auth-context.tsx          ← AuthProvider + useAuth hook
  app/
    (auth)/
      layout.tsx              ← Centered layout for login/register
      login/page.tsx           ← Login form
      register/page.tsx        ← Register form
```

---

## The Steps

### Step A: Create the AuthContext

Create `frontend/src/contexts/auth-context.tsx`:

```typescript
'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { message } from 'antd';
import api from '@/lib/api';
import type { User, LoginResponse, Role } from '@/types';

interface AuthContextType {
  user: User | null;
  role: Role | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // On mount, check if we have a stored token and load user profile
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<LoginResponse>('/auth/login', {
      email,
      password,
    });

    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);

    message.success(`Welcome back, ${data.user.firstName}!`);
    router.push('/dashboard');
  }, [router]);

  const register = useCallback(async (registerData: RegisterData) => {
    const { data } = await api.post<LoginResponse>('/auth/register', registerData);

    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);

    message.success('Account created successfully!');
    router.push('/dashboard');
  }, [router]);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        user,
        role: (user?.role as Role) ?? null,
        isAuthenticated: !!user,
        loading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

**Why `'use client'`?**

React context uses `useState` and `useEffect`, which only work in client components. The `'use client'` directive tells Next.js this file runs in the browser, not on the server.

**Why store user in both state and localStorage?**

- `useState` provides reactivity — when user changes, components re-render
- `localStorage` provides persistence — when the user refreshes the page, we restore from storage instead of forcing a re-login

---

### Step B: Create the Auth layout

Create `frontend/src/app/(auth)/layout.tsx`:

```typescript
'use client';

import { ConfigProvider, theme } from 'antd';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
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
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        {children}
      </div>
    </ConfigProvider>
  );
}
```

---

### Step C: Create the Login page

Create `frontend/src/app/(auth)/login/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Card, Form, Input, Button, Typography, Space, Divider, Alert } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.email, values.password);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Login failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ width: 420, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Title level={3} style={{ margin: 0 }}>
            HR Insight AI
          </Title>
          <Text type="secondary">Predictive Workforce Analytics</Text>
        </div>

        {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}

        <Form layout="vertical" onFinish={onFinish} size="large" autoComplete="off">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="Email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Sign In
            </Button>
          </Form.Item>
        </Form>

        <Divider plain>
          <Text type="secondary">Don&apos;t have an account?</Text>
        </Divider>

        <Link href="/register">
          <Button block>Create Account</Button>
        </Link>
      </Space>
    </Card>
  );
}
```

---

### Step D: Create the Register page

Create `frontend/src/app/(auth)/register/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Card, Form, Input, Button, Typography, Space, Divider, Alert } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';

const { Title, Text } = Typography;

export default function RegisterPage() {
  const { register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      await register(values);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response
          ?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ width: 420, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Title level={3} style={{ margin: 0 }}>Create Account</Title>
          <Text type="secondary">Join HR Insight AI</Text>
        </div>

        {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}

        <Form layout="vertical" onFinish={onFinish} size="large" autoComplete="off">
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item
              name="firstName"
              rules={[{ required: true, message: 'Required' }]}
              style={{ width: '50%' }}
            >
              <Input prefix={<UserOutlined />} placeholder="First name" />
            </Form.Item>
            <Form.Item
              name="lastName"
              rules={[{ required: true, message: 'Required' }]}
              style={{ width: '50%' }}
            >
              <Input placeholder="Last name" />
            </Form.Item>
          </Space.Compact>

          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="Email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Please enter a password' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password (8+ characters)" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Create Account
            </Button>
          </Form.Item>
        </Form>

        <Divider plain>
          <Text type="secondary">Already have an account?</Text>
        </Divider>

        <Link href="/login">
          <Button block>Sign In</Button>
        </Link>
      </Space>
    </Card>
  );
}
```

---

## How to Verify It Worked

1. Start backend: `cd backend && npm run start:dev`
2. Start frontend: `cd frontend && npm run dev`
3. Visit `http://localhost:3001/login` → see the styled login card
4. Login with `admin@hrinsight.com` / `Password123!` → redirects to `/dashboard` (404 for now)
5. Check localStorage in DevTools → `access_token` and `user` stored
6. Visit `http://localhost:3001/register` → see the registration form
7. Register a new user → redirects to `/dashboard`

---

## Checklist

- [ ] `contexts/auth-context.tsx` — AuthProvider + useAuth hook with login/register/logout
- [ ] `(auth)/layout.tsx` — centered gradient background with ConfigProvider
- [ ] `(auth)/login/page.tsx` — antd Form with validation, error display, link to register
- [ ] `(auth)/register/page.tsx` — antd Form with firstName/lastName/email/password
- [ ] Login with seeded admin → token stored, redirect works
- [ ] Register new user → token stored, redirect works
- [ ] Refresh page → user persists (loaded from localStorage)

---

Once confirmed, move to **Step 3: Dashboard Layout** — the sidebar, header, and role-based navigation menu.
