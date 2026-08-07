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
          <Title level={3} style={{ margin: 0 }}>HR Insight AI</Title>
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

        <Divider plain><Text type="secondary">Don&apos;t have an account?</Text></Divider>

        <Link href="/register">
          <Button block>Create Account</Button>
        </Link>
      </Space>
    </Card>
  );
}
