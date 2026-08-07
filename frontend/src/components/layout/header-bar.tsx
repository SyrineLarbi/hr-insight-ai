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
      <Text strong style={{ fontSize: 16 }}>HR Insight AI</Text>
      <Space>
        {role && <Tag color={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</Tag>}
        <Dropdown menu={{ items: dropdownItems }} placement="bottomRight">
          <Button type="text" icon={<UserOutlined />}>{user?.firstName}</Button>
        </Dropdown>
      </Space>
    </Header>
  );
}
