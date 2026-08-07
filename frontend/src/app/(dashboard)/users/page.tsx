'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Table,
  Button,
  Modal,
  Form,
  Select,
  Space,
  Tag,
  Popconfirm,
  Result,
  Skeleton,
  message,
} from 'antd';
import { EditOutlined, DeleteOutlined, TeamOutlined } from '@ant-design/icons';
import api from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import type { User, Role, TeamSummary } from '@/types';
import { ROLE_COLORS, ROLE_LABELS } from '@/lib/constants';
import { extractApiError } from '@/lib/errors';

const { Title, Text } = Typography;

const ROLE_OPTIONS: { label: string; value: Role }[] = (
  ['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER', 'VIEWER'] as Role[]
).map((r) => ({ label: ROLE_LABELS[r], value: r }));

export default function UsersPage() {
  const { role, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [roleModal, setRoleModal] = useState<User | null>(null);
  const [teamsModal, setTeamsModal] = useState<User | null>(null);
  const [roleForm] = Form.useForm();
  const [teamsForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Teams are needed for the assign-teams modal; both are ADMIN-visible here.
      const [usersRes, teamsRes] = await Promise.all([
        api.get<User[]>('/users'),
        api.get<TeamSummary[]>('/teams'),
      ]);
      setUsers(usersRes.data);
      setTeams(teamsRes.data);
    } catch {
      message.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === 'ADMIN') load();
    else setLoading(false);
  }, [role, load]);

  if (role !== 'ADMIN') {
    return (
      <Result
        status="403"
        title="Access Denied"
        subTitle="Only Administrators can manage users."
      />
    );
  }

  const openRoleModal = (u: User) => {
    roleForm.setFieldsValue({ role: u.role });
    setRoleModal(u);
  };

  const openTeamsModal = (u: User) => {
    teamsForm.setFieldsValue({
      teamIds: (u.teamAssignments ?? []).map((a) => a.team.id),
    });
    setTeamsModal(u);
  };

  const handleRoleSave = async () => {
    if (!roleModal) return;
    const values = await roleForm.validateFields();
    setSaving(true);
    try {
      await api.patch(`/users/${roleModal.id}/role`, values);
      message.success(`Role updated to ${ROLE_LABELS[values.role as Role]}`);
      setRoleModal(null);
      load();
    } catch (err: unknown) {
      message.error(extractApiError(err, 'Failed to update role'));
    } finally {
      setSaving(false);
    }
  };

  const handleTeamsSave = async () => {
    if (!teamsModal) return;
    const values = await teamsForm.validateFields();
    setSaving(true);
    try {
      await api.post(`/users/${teamsModal.id}/assign-teams`, {
        teamIds: values.teamIds ?? [],
      });
      message.success('Team assignments updated');
      setTeamsModal(null);
      load();
    } catch (err: unknown) {
      message.error(extractApiError(err, 'Failed to assign teams'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/users/${id}`);
      message.success('User deleted');
      load();
    } catch (err: unknown) {
      message.error(extractApiError(err, 'Failed to delete user'));
    }
  };

  const columns = [
    {
      title: 'Name',
      key: 'name',
      render: (_: unknown, r: User) => (
        <Space direction="vertical" size={0}>
          <Text strong>
            {r.firstName} {r.lastName}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.email}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (r: Role) => <Tag color={ROLE_COLORS[r]}>{ROLE_LABELS[r]}</Tag>,
      filters: ROLE_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
      onFilter: (value: unknown, record: User) => record.role === value,
    },
    {
      title: 'Assigned Teams',
      key: 'teams',
      render: (_: unknown, r: User) => {
        const assigned = r.teamAssignments ?? [];
        // Only TEAM_MANAGER is actually scoped by assignments; others see everything.
        if (r.role !== 'TEAM_MANAGER') {
          return <Text type="secondary">All teams</Text>;
        }
        if (assigned.length === 0) {
          return <Tag color="warning">None — sees no data</Tag>;
        }
        return (
          <Space size={[0, 4]} wrap>
            {assigned.map((a) => (
              <Tag key={a.team.id}>{a.team.name}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d: string) => new Date(d).toLocaleDateString(),
      responsive: ['md' as const],
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, r: User) => {
        const isSelf = r.id === currentUser?.id;
        return (
          <Space wrap>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openRoleModal(r)}
              disabled={isSelf}
              title={isSelf ? 'You cannot change your own role' : 'Change role'}
            >
              Role
            </Button>
            <Button
              size="small"
              icon={<TeamOutlined />}
              onClick={() => openTeamsModal(r)}
              title="Assign teams"
            >
              Teams
            </Button>
            <Popconfirm
              title="Delete this user?"
              description="This also removes their team assignments."
              onConfirm={() => handleDelete(r.id)}
              disabled={isSelf}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={isSelf}
                title={isSelf ? 'You cannot delete yourself' : 'Delete user'}
              />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Title level={3}>User Management</Title>
      <Text type="secondary">
        Change roles and scope Team Managers to specific teams. A Team Manager
        with no assigned teams cannot see any employees or reports.
      </Text>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (
          <Table
            columns={columns}
            dataSource={users}
            rowKey="id"
            scroll={{ x: 800 }}
            pagination={{ pageSize: 20, showTotal: (t) => `Total: ${t} users` }}
          />
        )}
      </div>

      <Modal
        title={
          roleModal
            ? `Change role — ${roleModal.firstName} ${roleModal.lastName}`
            : 'Change role'
        }
        open={!!roleModal}
        onOk={handleRoleSave}
        onCancel={() => setRoleModal(null)}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Pick a role' }]}
          >
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Team Managers also need team assignments to see any data.
        </Text>
      </Modal>

      <Modal
        title={
          teamsModal
            ? `Assign teams — ${teamsModal.firstName} ${teamsModal.lastName}`
            : 'Assign teams'
        }
        open={!!teamsModal}
        onOk={handleTeamsSave}
        onCancel={() => setTeamsModal(null)}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={teamsForm} layout="vertical">
          <Form.Item
            name="teamIds"
            label="Teams"
            extra="Leave empty to remove all assignments."
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="Select teams"
              options={teams.map((t) => ({
                label: `${t.name} (${t.department})`,
                value: t.id,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function extractError(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message;
  if (Array.isArray(msg)) return msg[0];
  return msg ?? fallback;
}
