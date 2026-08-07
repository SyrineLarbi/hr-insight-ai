'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Typography, Table, Button, Modal, Form, Input, InputNumber,
  Space, Popconfirm, message, Spin, Row, Col, Breadcrumb,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import Link from 'next/link';
import api from '@/lib/api';
import type { Team, Employee } from '@/types';
import RoleGate from '@/components/common/role-gate';

const { Title, Text } = Typography;

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const loadTeam = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get<Team>(`/teams/${id}`);
    setTeam(data);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (emp: Employee) => { setEditing(emp); form.setFieldsValue(emp); setModalOpen(true); };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/employees/${editing.id}`, values);
        message.success('Employee updated');
      } else {
        await api.post('/employees', { ...values, teamId: id });
        message.success('Employee added');
      }
      setModalOpen(false);
      loadTeam();
    } catch {
      message.error('Operation failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (empId: string) => {
    await api.delete(`/employees/${empId}`);
    message.success('Employee deleted');
    loadTeam();
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>;
  if (!team) return <Text>Team not found</Text>;

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Employee) => (
        <Link href={`/employees/${record.id}`}>{name}</Link>
      ),
    },
    { title: 'Salary', dataIndex: 'salary', key: 'salary', render: (v: number) => `$${v.toLocaleString()}` },
    { title: 'Engagement', dataIndex: 'engagementScore', key: 'engagement' },
    { title: 'Performance', dataIndex: 'performanceScore', key: 'performance' },
    { title: 'Overtime (h)', dataIndex: 'overtimeHours', key: 'overtime' },
    { title: 'Tenure (mo)', dataIndex: 'tenureMonths', key: 'tenure' },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: Employee) => (
        <Space>
          <RoleGate allowed={['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER']}>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </RoleGate>
          <RoleGate allowed={['ADMIN', 'HR_MANAGER']}>
            <Popconfirm title="Delete this employee?" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </RoleGate>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumb items={[{ title: <Link href="/teams">Teams</Link> }, { title: team.name }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>{team.name}</Title>
          <Text type="secondary">{team.department} — {team.employees?.length ?? 0} employees</Text>
        </div>
        <RoleGate allowed={['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER']}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add Employee</Button>
        </RoleGate>
      </div>

      <Table columns={columns} dataSource={team.employees ?? []} rowKey="id" scroll={{ x: 800 }} />

      <Modal
        title={editing ? 'Edit Employee' : 'Add Employee'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: !editing, min: 2, max: 100 }]}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="salary" label="Salary ($)" rules={[{ required: !editing, type: 'number', min: 1 }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tenureMonths" label="Tenure (months)" rules={[{ required: !editing, type: 'number', min: 0 }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="engagementScore" label="Engagement (1-5)" rules={[{ required: !editing, type: 'number', min: 1, max: 5 }]}>
                <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="performanceScore" label="Performance (1-5)" rules={[{ required: !editing, type: 'number', min: 1, max: 5 }]}>
                <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="absenteeismDays" label="Absenteeism (days)" rules={[{ required: !editing, type: 'number', min: 0 }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="overtimeHours" label="Overtime (h/week)" rules={[{ required: !editing, type: 'number', min: 0 }]}>
                <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="lastPromotionMonths" label="Last Promotion (months)" rules={[{ required: !editing, type: 'number', min: 0 }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="trainingHours" label="Training (hours)" rules={[{ required: !editing, type: 'number', min: 0 }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
