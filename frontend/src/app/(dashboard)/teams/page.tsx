'use client';

import { useState, useEffect, useCallback } from 'react';
import { Typography, Table, Button, Modal, Form, Input, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import Link from 'next/link';
import api from '@/lib/api';
import type { Team } from '@/types';
import RoleGate from '@/components/common/role-gate';

const { Title } = Typography;

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const loadTeams = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get<Team[]>('/teams');
    setTeams(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (team: Team) => { setEditing(team); form.setFieldsValue(team); setModalOpen(true); };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/teams/${editing.id}`, values);
        message.success('Team updated');
      } else {
        await api.post('/teams', values);
        message.success('Team created');
      }
      setModalOpen(false);
      loadTeams();
    } catch {
      message.error('Operation failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/teams/${id}`);
    message.success('Team deleted');
    loadTeams();
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Team) => <Link href={`/teams/${record.id}`}>{name}</Link>,
    },
    { title: 'Department', dataIndex: 'department', key: 'department' },
    {
      title: 'Employees',
      key: 'employees',
      render: (_: unknown, record: Team) => record._count?.employees ?? 0,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: Team) => (
        <Space>
          <RoleGate allowed={['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER']}>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </RoleGate>
          <RoleGate allowed={['ADMIN']}>
            <Popconfirm title="Delete this team?" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </RoleGate>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Teams</Title>
        <RoleGate allowed={['ADMIN', 'HR_MANAGER']}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Create Team</Button>
        </RoleGate>
      </div>

      <Table columns={columns} dataSource={teams} rowKey="id" loading={loading} scroll={{ x: 600 }} />

      <Modal
        title={editing ? 'Edit Team' : 'Create Team'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Team Name" rules={[{ required: true, min: 2, max: 100 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="department" label="Department" rules={[{ required: true, min: 2, max: 100 }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
