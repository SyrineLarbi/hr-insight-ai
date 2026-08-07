'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Typography,
  Table,
  Button,
  Modal,
  Form,
  Select,
  Input,
  Space,
  Tag,
  Popconfirm,
  Skeleton,
  Empty,
  message,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import api from '@/lib/api';
import type { Employee, TeamSummary } from '@/types';
import RoleGate from '@/components/common/role-gate';
import EmployeeFormFields from '@/components/employees/employee-form-fields';
import { extractApiError } from '@/lib/errors';

const { Title, Text } = Typography;

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teamFilter, setTeamFilter] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = teamFilter ? `?teamId=${teamFilter}` : '';
      const [empRes, teamRes] = await Promise.all([
        api.get<Employee[]>(`/employees${params}`),
        api.get<TeamSummary[]>('/teams'),
      ]);
      setEmployees(empRes.data);
      setTeams(teamRes.data);
    } catch (err) {
      message.error(extractApiError(err, 'Failed to load employees'));
    } finally {
      setLoading(false);
    }
  }, [teamFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Name search is client-side — the list endpoint has no search param and the
  // dataset is team-scoped, so it stays small.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, search]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    if (teamFilter) form.setFieldsValue({ teamId: teamFilter });
    setModalOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    form.setFieldsValue(emp);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        // teamId is not part of UpdateEmployeeDto — strip it before PATCH.
        const { teamId: _teamId, ...rest } = values;
        await api.patch(`/employees/${editing.id}`, rest);
        message.success('Employee updated');
      } else {
        await api.post('/employees', values);
        message.success('Employee added');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      message.error(extractApiError(err, 'Operation failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/employees/${id}`);
      message.success('Employee deleted');
      load();
    } catch (err) {
      message.error(extractApiError(err, 'Failed to delete employee'));
    }
  };

  const teamName = (e: Employee) =>
    e.team?.name ?? teams.find((t) => t.id === e.teamId)?.name ?? '—';

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: Employee, b: Employee) => a.name.localeCompare(b.name),
      render: (name: string, r: Employee) => (
        <Link href={`/employees/${r.id}`}>{name}</Link>
      ),
    },
    {
      title: 'Team',
      key: 'team',
      render: (_: unknown, r: Employee) => (
        <Link href={`/teams/${r.teamId}`}>{teamName(r)}</Link>
      ),
    },
    {
      title: 'Salary',
      dataIndex: 'salary',
      key: 'salary',
      sorter: (a: Employee, b: Employee) => a.salary - b.salary,
      render: (v: number) => `$${v.toLocaleString()}`,
      responsive: ['sm' as const],
    },
    {
      title: 'Tenure',
      dataIndex: 'tenureMonths',
      key: 'tenureMonths',
      sorter: (a: Employee, b: Employee) => a.tenureMonths - b.tenureMonths,
      render: (v: number) => `${v} mo`,
      responsive: ['md' as const],
    },
    {
      title: 'Engagement',
      dataIndex: 'engagementScore',
      key: 'engagementScore',
      sorter: (a: Employee, b: Employee) =>
        a.engagementScore - b.engagementScore,
      render: (v: number) => (
        <Tag color={v < 2.5 ? 'red' : v < 3.5 ? 'orange' : 'green'}>
          {v.toFixed(1)}
        </Tag>
      ),
    },
    {
      title: 'Performance',
      dataIndex: 'performanceScore',
      key: 'performanceScore',
      sorter: (a: Employee, b: Employee) =>
        a.performanceScore - b.performanceScore,
      render: (v: number) => (
        <Tag color={v < 2.5 ? 'red' : v < 3.5 ? 'orange' : 'green'}>
          {v.toFixed(1)}
        </Tag>
      ),
      responsive: ['md' as const],
    },
    {
      title: 'Overtime',
      dataIndex: 'overtimeHours',
      key: 'overtimeHours',
      sorter: (a: Employee, b: Employee) => a.overtimeHours - b.overtimeHours,
      render: (v: number) => (
        <Text type={v > 10 ? 'danger' : undefined}>{v} h/wk</Text>
      ),
      responsive: ['lg' as const],
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, r: Employee) => (
        <Space>
          <RoleGate allowed={['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER']}>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </RoleGate>
          <RoleGate allowed={['ADMIN', 'HR_MANAGER']}>
            <Popconfirm
              title="Delete this employee?"
              onConfirm={() => handleDelete(r.id)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </RoleGate>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          Employees
        </Title>
        <RoleGate allowed={['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER']}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Employee
          </Button>
        </RoleGate>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search by name"
          style={{ width: 220 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          placeholder="All teams"
          allowClear
          style={{ width: 220 }}
          value={teamFilter}
          onChange={setTeamFilter}
          options={teams.map((t) => ({
            label: `${t.name} (${t.department})`,
            value: t.id,
          }))}
        />
        <Text type="secondary">
          {filtered.length} of {employees.length} shown
        </Text>
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          scroll={{ x: 900 }}
          locale={{
            emptyText: (
              <Empty
                description={
                  search || teamFilter
                    ? 'No employees match these filters'
                    : 'No employees yet'
                }
              />
            ),
          }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `Total: ${t} employees`,
          }}
        />
      )}

      <Modal
        title={editing ? 'Edit Employee' : 'Add Employee'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item
              name="teamId"
              label="Team"
              rules={[{ required: true, message: 'Pick a team' }]}
            >
              <Select
                placeholder="Select a team"
                options={teams.map((t) => ({
                  label: `${t.name} (${t.department})`,
                  value: t.id,
                }))}
              />
            </Form.Item>
          )}
          <EmployeeFormFields required={!editing} />
        </Form>
      </Modal>
    </div>
  );
}
