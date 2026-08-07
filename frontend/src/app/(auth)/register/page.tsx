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
          <Form.Item
            name="firstName"
            rules={[{ required: true, message: 'First name is required' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="First name" />
          </Form.Item>
          <Form.Item
            name="lastName"
            rules={[{ required: true, message: 'Last name is required' }]}
          >
            <Input placeholder="Last name" />
          </Form.Item>

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

        <Divider plain><Text type="secondary">Already have an account?</Text></Divider>

        <Link href="/login">
          <Button block>Sign In</Button>
        </Link>
      </Space>
    </Card>
  );
}
