'use client';

import { ConfigProvider, App, theme } from 'antd';
import { AuthProvider } from '@/contexts/auth-context';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: { colorPrimary: '#1677ff', borderRadius: 8 },
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <App>
        <AuthProvider>
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
        </AuthProvider>
      </App>
    </ConfigProvider>
  );
}
