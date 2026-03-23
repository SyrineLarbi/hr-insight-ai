# Phase 7 - Step 5: Teams & Employees Pages — CRUD Tables + Modals

## Why Are We Doing This?

The dashboard shows aggregated analytics, but HR professionals also need to **manage the raw data** — create teams, add employees, update metrics, transfer employees between teams, and delete records. These pages are the CRUD interface layer on top of the API built in Phase 3.

antd's `Table` component handles sorting, filtering, and pagination out of the box. Modals provide inline create/edit forms without navigating away from the list. This pattern — table + modal — is the standard for enterprise admin panels.

---

## What We're Building

```
frontend/src/
  app/(dashboard)/
    teams/
      page.tsx               ← Teams list table + create modal
      [id]/page.tsx          ← Team detail: employee table + add/edit modals
    employees/
      [id]/page.tsx          ← Employee detail: info + risk timeline chart
```

---

## The Steps

### Step A: Create the Teams list page

Create `frontend/src/app/(dashboard)/teams/page.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Typography, Table, Button, Modal, Form, Input, Space, Tag,
  Popconfirm, message,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import api from '@/lib/api';
import type { Team } from '@/types';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

export default function TeamsPage() {
  const { role } = useAuth();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const canCreate = role === 'ADMIN' || role === 'HR_MANAGER';
  const canDelete = role === 'ADMIN';

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Team[]>('/teams');
      setTeams(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingTeam) {
        await api.patch(`/teams/${editingTeam.id}`, values);
        message.success('Team updated');
      } else {
        await api.post('/teams', values);
        message.success('Team created');
      }
      setModalOpen(false);
      form.resetFields();
      setEditingTeam(null);
      fetchTeams();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? 'Operation failed';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/teams/${id}`);
      message.success('Team deleted');
      fetchTeams();
    } catch {
      message.error('Failed to delete team');
    }
  };

  const openEdit = (team: Team) => {
    setEditingTeam(team);
    form.setFieldsValue({ name: team.name, department: team.department });
    setModalOpen(true);
  };

  const columns: ColumnsType<Team> = [
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name, record) => (
        <a onClick={() => router.push(`/teams/${record.id}`)}>{name}</a>
      ),
    },
    {
      title: 'Department',
      dataIndex: 'department',
      filters: [...new Set(teams.map((t) => t.department))].map((d) => ({
        text: d, value: d,
      })),
      onFilter: (value, record) => record.department === value,
    },
    {
      title: 'Employees',
      dataIndex: ['_count', 'employees'],
      sorter: (a, b) => (a._count?.employees ?? 0) - (b._count?.employees ?? 0),
      render: (count: number) => <Tag>{count}</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          {(role === 'ADMIN' || role === 'HR_MANAGER' || role === 'TEAM_MANAGER') && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          )}
          {canDelete && (
            <Popconfirm
              title="Delete this team?"
              description="This will also delete all employees in this team."
              onConfirm={() => handleDelete(record.id)}
              okText="Delete"
              okType="danger"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Teams</Title>
        {canCreate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditingTeam(null); form.resetFields(); setModalOpen(true); }}
          >
            Create Team
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        dataSource={teams}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editingTeam ? 'Edit Team' : 'Create Team'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditingTeam(null); form.resetFields(); }}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Team Name" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="e.g., Platform Engineering" />
          </Form.Item>
          <Form.Item name="department" label="Department" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="e.g., Engineering" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

---

### Step B: Create the Team Detail page (with employee table)

Create `frontend/src/app/(dashboard)/teams/[id]/page.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Typography, Table, Button, Modal, Form, Input, InputNumber,
  Space, Tag, Breadcrumb, Popconfirm, message, Card, Descriptions, Spin,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/auth-context';
import api from '@/lib/api';
import type { Team, Employee } from '@/types';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { role } = useAuth();
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const canCreate = role === 'ADMIN' || role === 'HR_MANAGER' || role === 'TEAM_MANAGER';
  const canDelete = role === 'ADMIN' || role === 'HR_MANAGER';

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Team>(`/teams/${id}`);
      setTeam(data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingEmployee) {
        await api.patch(`/employees/${editingEmployee.id}`, values);
        message.success('Employee updated');
      } else {
        await api.post('/employees', { ...values, teamId: id });
        message.success('Employee added');
      }
      setModalOpen(false);
      form.resetFields();
      setEditingEmployee(null);
      fetchTeam();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      message.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (empId: string) => {
    try {
      await api.delete(`/employees/${empId}`);
      message.success('Employee deleted');
      fetchTeam();
    } catch {
      message.error('Failed to delete employee');
    }
  };

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    form.setFieldsValue(emp);
    setModalOpen(true);
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />;
  if (!team) return <Title level={4}>Team not found</Title>;

  const columns: ColumnsType<Employee> = [
    {
      title: 'Name', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name, record) => (
        <a onClick={() => router.push(`/employees/${record.id}`)}>{name}</a>
      ),
    },
    { title: 'Salary', dataIndex: 'salary', render: (v: number) => `$${v.toLocaleString()}`, sorter: (a, b) => a.salary - b.salary },
    { title: 'Engagement', dataIndex: 'engagementScore', sorter: (a, b) => a.engagementScore - b.engagementScore,
      render: (v: number) => <Tag color={v < 3 ? 'red' : v < 4 ? 'orange' : 'green'}>{v}/5</Tag> },
    { title: 'Performance', dataIndex: 'performanceScore', sorter: (a, b) => a.performanceScore - b.performanceScore,
      render: (v: number) => <Tag color={v < 3 ? 'red' : v < 4 ? 'orange' : 'green'}>{v}/5</Tag> },
    { title: 'Overtime', dataIndex: 'overtimeHours', render: (v: number) => `${v}h` },
    { title: 'Tenure', dataIndex: 'tenureMonths', render: (v: number) => `${v}mo` },
    {
      title: 'Actions', key: 'actions',
      render: (_, record) => (
        <Space>
          {canCreate && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />}
          {canDelete && (
            <Popconfirm title="Delete this employee?" onConfirm={() => handleDelete(record.id)} okType="danger">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumb items={[
        { title: <a onClick={() => router.push('/teams')}>Teams</a> },
        { title: team.name },
      ]} />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>{team.name}</Title>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />}
            onClick={() => { setEditingEmployee(null); form.resetFields(); setModalOpen(true); }}>
            Add Employee
          </Button>
        )}
      </div>

      <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Department">{team.department}</Descriptions.Item>
        <Descriptions.Item label="Employees">{team.employees?.length ?? 0}</Descriptions.Item>
      </Descriptions>

      <Table columns={columns} dataSource={team.employees ?? []} rowKey="id" pagination={{ pageSize: 15 }} />

      <Modal
        title={editingEmployee ? 'Edit Employee' : 'Add Employee'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditingEmployee(null); form.resetFields(); }}
        confirmLoading={submitting}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="salary" label="Salary ($)" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="tenureMonths" label="Tenure (months)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="engagementScore" label="Engagement (1-5)" rules={[{ required: true }]}>
              <InputNumber min={1} max={5} step={0.1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="performanceScore" label="Performance (1-5)" rules={[{ required: true }]}>
              <InputNumber min={1} max={5} step={0.1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="absenteeismDays" label="Absent Days" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="overtimeHours" label="Overtime (h/wk)" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.5} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="lastPromotionMonths" label="Last Promo (months)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="trainingHours" label="Training Hours" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 150 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
```

---

### Step C: Create the Employee Detail page

Create `frontend/src/app/(dashboard)/employees/[id]/page.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Typography, Descriptions, Card, Tag, Breadcrumb, Spin, Row, Col, Statistic, Empty,
} from 'antd';
import api from '@/lib/api';
import type { Employee } from '@/types';
import { RISK_COLORS } from '@/lib/constants';

const { Title, Text } = Typography;

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Employee>(`/employees/${id}`)
      .then(({ data }) => setEmployee(data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />;
  if (!employee) return <Title level={4}>Employee not found</Title>;

  const scoreTag = (value: number) => (
    <Tag color={value < 3 ? 'red' : value < 4 ? 'orange' : 'green'}>{value}/5</Tag>
  );

  return (
    <div>
      <Breadcrumb items={[
        { title: <a onClick={() => router.push('/teams')}>Teams</a> },
        { title: <a onClick={() => router.push(`/teams/${employee.teamId}`)}>{employee.team?.name}</a> },
        { title: employee.name },
      ]} />

      <Title level={3} style={{ marginTop: 16 }}>{employee.name}</Title>

      <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }} style={{ marginBottom: 24 }}>
        <Descriptions.Item label="Team">{employee.team?.name}</Descriptions.Item>
        <Descriptions.Item label="Department">{employee.team?.department}</Descriptions.Item>
        <Descriptions.Item label="Salary">${employee.salary.toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="Tenure">{employee.tenureMonths} months</Descriptions.Item>
        <Descriptions.Item label="Engagement">{scoreTag(employee.engagementScore)}</Descriptions.Item>
        <Descriptions.Item label="Performance">{scoreTag(employee.performanceScore)}</Descriptions.Item>
        <Descriptions.Item label="Overtime">{employee.overtimeHours}h/week</Descriptions.Item>
        <Descriptions.Item label="Absenteeism">{employee.absenteeismDays} days</Descriptions.Item>
        <Descriptions.Item label="Last Promotion">{employee.lastPromotionMonths} months ago</Descriptions.Item>
        <Descriptions.Item label="Training">{employee.trainingHours} hours</Descriptions.Item>
      </Descriptions>

      <Card title="Risk Score Timeline">
        {employee.riskSnapshots && employee.riskSnapshots.length > 0 ? (
          <Row gutter={[8, 8]}>
            {employee.riskSnapshots.map((snap) => (
              <Col key={snap.id} xs={12} sm={8} lg={4}>
                <Card size="small" style={{ textAlign: 'center' }}>
                  <Statistic
                    title={new Date(snap.snapshotDate).toLocaleDateString()}
                    value={Math.round(snap.riskScore * 100)}
                    suffix="%"
                    valueStyle={{ color: RISK_COLORS[snap.riskLevel] }}
                  />
                  <Tag color={RISK_COLORS[snap.riskLevel]}>{snap.riskLevel}</Tag>
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty description="No risk snapshots yet — generate a report for this team to create risk data" />
        )}
      </Card>
    </div>
  );
}
```

---

## How to Verify It Worked

1. Login as ADMIN → navigate to Teams → see 3 seeded teams with employee counts
2. Click "Create Team" → fill form → team appears in table
3. Click a team name → see team detail with employee table
4. Click "Add Employee" → fill all 9 fields → employee appears
5. Edit an employee → values update
6. Delete an employee → removed from table
7. Click employee name → see employee detail with all metrics
8. Login as VIEWER → no Create/Edit/Delete buttons visible
9. Login as TEAM_MANAGER → sees only their team(s)

---

## Checklist

- [ ] Teams page: table with sort/filter, create/edit modals, delete confirmation
- [ ] Team detail: employee table with all 9 fields, add/edit/delete
- [ ] Employee detail: full descriptions, risk timeline (empty for now)
- [ ] RBAC: VIEWER sees no action buttons, TEAM_MANAGER sees only assigned teams
- [ ] Color-coded engagement/performance tags (red/orange/green)

---

Once confirmed, move to **Step 6: Reports, Audit Logs, and remaining pages**.
