'use client';

import { Menu } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  UserOutlined,
  FileTextOutlined,
  AuditOutlined,
  SettingOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/types';

interface SidebarMenuProps {
  role: Role | null;
  collapsed?: boolean;
}

export default function SidebarMenu({ role }: SidebarMenuProps) {
  const pathname = usePathname();
  const router = useRouter();

  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    { key: '/teams', icon: <TeamOutlined />, label: 'Teams' },
    { key: '/employees', icon: <UserOutlined />, label: 'Employees' },
    { key: '/reports', icon: <FileTextOutlined />, label: 'Reports' },
    { key: '/simulation', icon: <ExperimentOutlined />, label: 'Simulation' },
    ...(role === 'ADMIN' || role === 'HR_MANAGER'
      ? [{ key: '/audit-logs', icon: <AuditOutlined />, label: 'Audit Logs' }]
      : []),
    ...(role === 'ADMIN'
      ? [{ key: '/users', icon: <SettingOutlined />, label: 'User Management' }]
      : []),
  ];

  // Longest match wins so /teams/:id doesn't also match a shorter sibling key.
  const selectedKey =
    menuItems
      .filter((item) => pathname.startsWith(item.key))
      .sort((a, b) => b.key.length - a.key.length)[0]?.key ?? '/dashboard';

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
