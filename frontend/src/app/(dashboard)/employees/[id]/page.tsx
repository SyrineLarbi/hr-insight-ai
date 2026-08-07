'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Typography, Card, Row, Col, Statistic, Spin, Breadcrumb, Tag, Table, Empty } from 'antd';
import Link from 'next/link';
import api from '@/lib/api';
import type { Employee, RiskSnapshot } from '@/types';
import { RISK_COLORS, RISK_LABELS } from '@/lib/constants';

const { Title, Text } = Typography;

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Employee>(`/employees/${id}`)
      .then(({ data }) => setEmployee(data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>;
  if (!employee) return <Text>Employee not found</Text>;

  const snapshotCols = [
    { title: 'Date', dataIndex: 'snapshotDate', key: 'date', render: (d: string) => new Date(d).toLocaleDateString() },
    { title: 'Risk Score', dataIndex: 'riskScore', key: 'score', render: (v: number) => `${Math.round(v * 100)}%` },
    {
      title: 'Level',
      dataIndex: 'riskLevel',
      key: 'level',
      render: (level: string) => (
        <Tag color={RISK_COLORS[level as keyof typeof RISK_COLORS]}>
          {RISK_LABELS[level as keyof typeof RISK_LABELS]}
        </Tag>
      ),
    },
    { title: 'Model', dataIndex: 'modelVersion', key: 'model' },
  ];

  return (
    <div>
      <Breadcrumb items={[
        { title: <Link href="/teams">Teams</Link> },
        { title: <Link href={`/teams/${employee.teamId}`}>{employee.team?.name}</Link> },
        { title: employee.name },
      ]} />

      <Title level={3} style={{ marginTop: 16 }}>{employee.name}</Title>
      <Text type="secondary">{employee.team?.name} — {employee.team?.department}</Text>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Salary" value={employee.salary} prefix="$" precision={0} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Tenure" value={employee.tenureMonths} suffix="mo" /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Engagement" value={employee.engagementScore} suffix="/5" precision={1} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Performance" value={employee.performanceScore} suffix="/5" precision={1} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Absenteeism" value={employee.absenteeismDays} suffix="days" /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Overtime" value={employee.overtimeHours} suffix="h/wk" precision={1} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Last Promotion" value={employee.lastPromotionMonths} suffix="mo ago" /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card size="small"><Statistic title="Training" value={employee.trainingHours} suffix="hrs" precision={0} /></Card></Col>
      </Row>

      <Card title="Risk Timeline" style={{ marginTop: 24 }}>
        {employee.riskSnapshots && employee.riskSnapshots.length > 0 ? (
          <Table columns={snapshotCols} dataSource={employee.riskSnapshots} rowKey="id" pagination={false} size="small" />
        ) : (
          <Empty description="No risk snapshots yet. Generate a report for this team to create risk predictions." />
        )}
      </Card>
    </div>
  );
}
