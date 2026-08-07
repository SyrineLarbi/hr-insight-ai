'use client';

import { useState, useEffect, useCallback } from 'react';
import { Typography, Table, Select, Space, Tag, Result } from 'antd';
import api from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import type { AuditLog, PaginatedResponse, AuditAction } from '@/types';
import { ROLE_COLORS } from '@/lib/constants';
import type { Role } from '@/types';

const { Title } = Typography;

const ACTION_OPTIONS: { label: string; value: AuditAction }[] = [
  { label: 'Create', value: 'CREATE' },
  { label: 'Update', value: 'UPDATE' },
  { label: 'Delete', value: 'DELETE' },
  { label: 'Generate Report', value: 'GENERATE_REPORT' },
  { label: 'Export PDF', value: 'EXPORT_PDF' },
  { label: 'Login', value: 'LOGIN' },
];

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  GENERATE_REPORT: 'purple',
  EXPORT_PDF: 'cyan',
  LOGIN: 'default',
};

export default function AuditLogsPage() {
  const { role } = useAuth();
  const [data, setData] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<AuditAction | undefined>();
  const [entityFilter, setEntityFilter] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (actionFilter) params.set('action', actionFilter);
    if (entityFilter) params.set('entityType', entityFilter);

    const { data: res } = await api.get<PaginatedResponse<AuditLog>>(`/audit-logs?${params}`);
    setData(res.data);
    setTotal(res.meta.total);
    setLoading(false);
  }, [page, actionFilter, entityFilter]);

  useEffect(() => { load(); }, [load]);

  if (role !== 'ADMIN' && role !== 'HR_MANAGER') {
    return <Result status="403" title="Access Denied" subTitle="Only Admin and HR Manager can view audit logs." />;
  }

  const columns = [
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      render: (a: string) => <Tag color={ACTION_COLORS[a]}>{a}</Tag>,
    },
    { title: 'Entity', dataIndex: 'entityType', key: 'entityType' },
    {
      title: 'Entity ID',
      dataIndex: 'entityId',
      key: 'entityId',
      render: (v: string | null) => v ? `${v.substring(0, 8)}...` : '—',
    },
    {
      title: 'User',
      key: 'user',
      render: (_: unknown, r: AuditLog) => (
        <Space>
          {r.user.firstName} {r.user.lastName}
          <Tag color={ROLE_COLORS[r.user.role as Role]}>{r.user.role}</Tag>
        </Space>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d: string) => new Date(d).toLocaleString(),
    },
  ];

  return (
    <div>
      <Title level={3}>Audit Logs</Title>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="Filter by action"
          allowClear
          style={{ width: 180 }}
          options={ACTION_OPTIONS}
          onChange={setActionFilter}
        />
        <Select
          placeholder="Filter by entity"
          allowClear
          style={{ width: 150 }}
          options={['USER', 'TEAM', 'EMPLOYEE', 'REPORT'].map((e) => ({ label: e, value: e }))}
          onChange={setEntityFilter}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 700 }}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: setPage,
          showTotal: (t) => `Total: ${t} entries`,
        }}
      />
    </div>
  );
}
