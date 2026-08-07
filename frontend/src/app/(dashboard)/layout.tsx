'use client';

import { ConfigProvider, App, theme } from 'antd';
import { AuthProvider } from '@/contexts/auth-context';
import AppLayout from '@/components/layout/app-layout';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: { colorPrimary: '#1677ff', borderRadius: 8 },
        components: {
          Layout: { siderBg: '#fff', headerBg: '#fff' },
          Table: { headerBg: '#fafafa' },
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
