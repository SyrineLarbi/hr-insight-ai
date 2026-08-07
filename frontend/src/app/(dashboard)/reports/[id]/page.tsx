'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
  Typography,
  Card,
  Tag,
  Spin,
  Breadcrumb,
  Descriptions,
  Empty,
  Button,
  Row,
  Col,
  Statistic,
  Table,
  Space,
  message,
} from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import api from '@/lib/api';
import type { Report, RiskSnapshot } from '@/types';
import { getRiskLevel, RISK_COLORS, RISK_LABELS } from '@/lib/constants';
import RoiCalculator from '@/components/dashboard/roi-calculator';

const { Title, Text } = Typography;

interface Priority {
  rank: number;
  title: string;
  description: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  timeline: string;
  estimatedCost: string;
  affectedEmployees: number;
}

interface RetentionStrategy {
  strategy: string;
  targetGroup: string;
  expectedImpact: string;
  steps: string[];
}

interface RiskMitigation {
  risk: string;
  probability: 'LOW' | 'MEDIUM' | 'HIGH';
  mitigation: string;
  owner: string;
}

interface ProjectedRoi {
  currentRiskCost?: string;
  projectedSavings?: string;
  timeframe?: string;
  assumptions?: string[];
}

interface ActionPlanShape {
  priorities?: Priority[];
  retentionStrategies?: RetentionStrategy[];
  riskMitigations?: RiskMitigation[];
  projectedRoi?: ProjectedRoi;
  _generatedBy?: string;
}

const IMPACT_COLORS: Record<string, string> = {
  HIGH: 'red',
  MEDIUM: 'orange',
  LOW: 'green',
};

function toPercent(score: number | null): number | null {
  if (score == null) return null;
  return score <= 1 ? Math.round(score * 100) : Math.round(score);
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [snapshots, setSnapshots] = useState<RiskSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Report>(`/reports/${id}`)
      .then(({ data }) => setReport(data))
      .finally(() => setLoading(false));

    // Per-employee scores power the ROI calculator. A failure here is not fatal
    // to the page, so the calculator just shows its empty state.
    api
      .get<RiskSnapshot[]>(`/reports/${id}/risk-snapshots`)
      .then(({ data }) => setSnapshots(data))
      .catch(() => setSnapshots([]));
  }, [id]);

  const handleExportPdf = async () => {
    try {
      const response = await api.get(`/reports/${id}/pdf`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `hr-insight-${report?.team?.name ?? 'report'}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('PDF export failed');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!report) return <Text>Report not found</Text>;

  const riskPct = toPercent(report.riskScore);
  const level = riskPct != null ? getRiskLevel(riskPct / 100) : null;
  const plan = (report.actionPlans?.[0]?.planJson ?? null) as
    | ActionPlanShape
    | null;

  const riskByEmployee = new Map(
    snapshots.map((s) => [s.employeeId, s.riskScore]),
  );
  // riskScore is stored 0-100; the ROI model works in 0-1 probabilities.
  const roiEmployees = (report.team?.employees ?? [])
    .filter((e) => riskByEmployee.has(e.id))
    .map((e) => ({
      salary: e.salary,
      riskScore: (riskByEmployee.get(e.id) ?? 0) / 100,
    }));

  return (
    <div>
      <Breadcrumb
        items={[
          { title: <Link href="/reports">Reports</Link> },
          { title: report.team?.name ?? report.id },
        ]}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 16,
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          Report — {report.team?.name}
        </Title>
        {report.status === 'COMPLETED' && (
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleExportPdf}
          >
            Export PDF
          </Button>
        )}
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title="Overall Risk Score"
              value={riskPct ?? 0}
              suffix="%"
              valueStyle={{
                color: level ? RISK_COLORS[level] : undefined,
                fontSize: 40,
              }}
            />
            {level && (
              <Tag color={RISK_COLORS[level]} style={{ marginTop: 8 }}>
                {RISK_LABELS[level]}
              </Tag>
            )}
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card>
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Status">
                <Tag
                  color={
                    report.status === 'COMPLETED'
                      ? 'green'
                      : report.status === 'FAILED'
                        ? 'red'
                        : 'blue'
                  }
                >
                  {report.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Date Range">
                {new Date(report.dateRangeStart).toLocaleDateString()} —{' '}
                {new Date(report.dateRangeEnd).toLocaleDateString()}
              </Descriptions.Item>
              <Descriptions.Item label="Generated">
                {new Date(report.createdAt).toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="Model">
                {report.modelVersion ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="By" span={2}>
                {report.generatedByUser
                  ? `${report.generatedByUser.firstName} ${report.generatedByUser.lastName} (${report.generatedByUser.email})`
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {report.summaryText ? (
        <Card title="Executive Summary" style={{ marginBottom: 16 }}>
          <div className="report-summary">
            <ReactMarkdown>{report.summaryText}</ReactMarkdown>
          </div>
        </Card>
      ) : (
        <Empty description="No summary available" style={{ marginBottom: 16 }} />
      )}

      {plan?.priorities && plan.priorities.length > 0 && (
        <Card title="Action Plan — Priorities" style={{ marginBottom: 16 }}>
          <Table<Priority>
            columns={[
              {
                title: '#',
                dataIndex: 'rank',
                width: 50,
                align: 'center',
              },
              {
                title: 'Priority',
                key: 'title',
                render: (_, p) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.title}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(0,0,0,0.55)',
                        marginTop: 4,
                      }}
                    >
                      {p.description}
                    </div>
                  </div>
                ),
              },
              {
                title: 'Impact',
                dataIndex: 'impact',
                width: 100,
                render: (i: string) => (
                  <Tag color={IMPACT_COLORS[i] ?? 'default'}>{i}</Tag>
                ),
              },
              { title: 'Timeline', dataIndex: 'timeline', width: 120 },
              { title: 'Cost', dataIndex: 'estimatedCost', width: 140 },
              {
                title: 'Affects',
                dataIndex: 'affectedEmployees',
                width: 80,
                align: 'center',
                render: (n: number) => `${n}`,
              },
            ]}
            dataSource={plan.priorities}
            rowKey="rank"
            pagination={false}
            size="small"
          />
        </Card>
      )}

      {plan?.retentionStrategies && plan.retentionStrategies.length > 0 && (
        <Card title="Retention Strategies" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {plan.retentionStrategies.map((s, i) => (
              <Card key={i} size="small" type="inner" title={s.strategy}>
                <div style={{ marginBottom: 8 }}>
                  <Tag>Target: {s.targetGroup}</Tag>
                  <Tag color="blue">Expected: {s.expectedImpact}</Tag>
                </div>
                <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                  {s.steps.map((step, j) => (
                    <li key={j}>{step}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </Space>
        </Card>
      )}

      {plan?.riskMitigations && plan.riskMitigations.length > 0 && (
        <Card title="Risk Mitigations" style={{ marginBottom: 16 }}>
          <Table<RiskMitigation>
            columns={[
              { title: 'Risk', dataIndex: 'risk' },
              {
                title: 'Probability',
                dataIndex: 'probability',
                width: 120,
                render: (p: string) => (
                  <Tag color={IMPACT_COLORS[p] ?? 'default'}>{p}</Tag>
                ),
              },
              { title: 'Mitigation', dataIndex: 'mitigation' },
              { title: 'Owner', dataIndex: 'owner', width: 140 },
            ]}
            dataSource={plan.riskMitigations}
            rowKey={(r) => r.risk}
            pagination={false}
            size="small"
          />
        </Card>
      )}

      {plan?.projectedRoi && (
        <Card title="Projected ROI" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Statistic
                title="Current Risk Cost"
                value={plan.projectedRoi.currentRiskCost ?? '—'}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Col>
            <Col xs={24} md={6}>
              <Statistic
                title="Projected Savings"
                value={plan.projectedRoi.projectedSavings ?? '—'}
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col xs={24} md={6}>
              <Statistic
                title="Timeframe"
                value={plan.projectedRoi.timeframe ?? '—'}
              />
            </Col>
          </Row>
          {plan.projectedRoi.assumptions &&
            plan.projectedRoi.assumptions.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>Assumptions:</Text>
                <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                  {plan.projectedRoi.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
        </Card>
      )}

      <div style={{ marginBottom: 16 }}>
        <RoiCalculator
          employees={roiEmployees}
          teamName={report.team?.name}
        />
      </div>

      {plan?._generatedBy === 'fallback-template' && (
        <Card style={{ background: '#fff7e6', borderColor: '#ffd591' }}>
          <Text type="warning">
            This action plan was produced by the fallback template because the
            LLM was unavailable. Regenerate the report to get a full AI-powered
            plan.
          </Text>
        </Card>
      )}
    </div>
  );
}
