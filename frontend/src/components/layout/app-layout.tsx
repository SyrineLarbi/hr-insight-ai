'use client';

import { Layout, Spin } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import SidebarMenu from './sidebar-menu';
import HeaderBar from './header-bar';

const { Sider, Content } = Layout;

export default function AppLayout({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated, role } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        collapsedWidth={80}
        style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}
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
