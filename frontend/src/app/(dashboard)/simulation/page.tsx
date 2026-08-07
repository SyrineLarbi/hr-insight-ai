'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Card,
  Select,
  Slider,
  Button,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Space,
  Alert,
  Skeleton,
  Empty,
  Divider,
  message,
} from 'antd';
import {
  ExperimentOutlined,
  ReloadOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
} from '@ant-design/icons';
import api from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import type { TeamSummary, SimulationResult } from '@/types';
import { extractApiError } from '@/lib/errors';
import { RISK_COLORS } from '@/lib/constants';

const { Title, Text, Paragraph } = Typography;

interface Lever {
  key: keyof Adjustments;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
  /** Direction that should reduce risk — used only for the helper text. */
  hint: string;
}

interface Adjustments {
  salaryPercent: number;
  engagementDelta: number;
  performanceDelta: number;
  overtimeDelta: number;
  trainingDelta: number;
  promotionDelta: number;
  absenteeismDelta: number;
}

const LEVERS: Lever[] = [
  {
    key: 'salaryPercent',
    label: 'Salary',
    min: -50,
    max: 50,
    step: 1,
    suffix: '%',
    hint: 'Across-the-board pay adjustment',
  },
  {
    key: 'engagementDelta',
    label: 'Engagement score',
    min: -2,
    max: 2,
    step: 0.1,
    suffix: ' pts',
    hint: 'Effect of engagement initiatives (scale 1–5)',
  },
  {
    key: 'performanceDelta',
    label: 'Performance score',
    min: -2,
    max: 2,
    step: 0.1,
    suffix: ' pts',
    hint: 'Effect of coaching and enablement (scale 1–5)',
  },
  {
    key: 'overtimeDelta',
    label: 'Weekly overtime',
    min: -20,
    max: 20,
    step: 0.5,
    suffix: ' h',
    hint: 'Negative = hiring relief or scope reduction',
  },
  {
    key: 'trainingDelta',
    label: 'Annual training',
    min: -40,
    max: 100,
    step: 5,
    suffix: ' h',
    hint: 'Investment in development hours',
  },
  {
    key: 'promotionDelta',
    label: 'Months since promotion',
    min: -24,
    max: 24,
    step: 1,
    suffix: ' mo',
    hint: 'Negative = bringing promotion cycles forward',
  },
  {
    key: 'absenteeismDelta',
    label: 'Monthly absenteeism',
    min: -10,
    max: 10,
    step: 0.5,
    suffix: ' d',
    hint: 'Negative = improved wellbeing',
  },
];

const ZERO: Adjustments = {
  salaryPercent: 0,
  engagementDelta: 0,
  performanceDelta: 0,
  overtimeDelta: 0,
  trainingDelta: 0,
  promotionDelta: 0,
  absenteeismDelta: 0,
};

export default function SimulationPage() {
  const { role } = useAuth();
  const canSimulate = role !== 'VIEWER';

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamId, setTeamId] = useState<string | undefined>();
  const [adjustments, setAdjustments] = useState<Adjustments>(ZERO);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<TeamSummary[]>('/teams');
        setTeams(data);
        if (data.length > 0) setTeamId(data[0].id);
      } catch (err) {
        message.error(extractApiError(err, 'Failed to load teams'));
      } finally {
        setLoadingTeams(false);
      }
    })();
  }, []);

  const hasChanges = Object.values(adjustments).some((v) => v !== 0);

  const run = useCallback(async () => {
    if (!teamId) return;
    setRunning(true);
    try {
      const { data } = await api.post<SimulationResult>('/analytics/simulate', {
        teamId,
        ...adjustments,
      });
      setResult(data);
    } catch (err) {
      message.error(extractApiError(err, 'Simulation failed'));
    } finally {
      setRunning(false);
    }
  }, [teamId, adjustments]);

  const reset = () => {
    setAdjustments(ZERO);
    setResult(null);
  };

  if (!canSimulate) {
    return (
      <div>
        <Title level={3}>Simulation</Title>
        <Alert
          type="info"
          showIcon
          message="Read-only access"
          description="Simulation runs live model predictions, which Viewers cannot trigger. Ask an HR Manager to run a scenario for you."
        />
      </div>
    );
  }

  const delta = result?.deltaRiskScore ?? 0;
  const improved = delta < 0;

  const employeeColumns = [
    { title: 'Employee', dataIndex: 'name', key: 'name' },
    {
      title: 'Current risk',
      dataIndex: 'baselineRisk',
      key: 'baselineRisk',
      sorter: (a: { baselineRisk: number }, b: { baselineRisk: number }) =>
        a.baselineRisk - b.baselineRisk,
      render: (v: number) => `${v}%`,
    },
    {
      title: 'Simulated risk',
      dataIndex: 'simulatedRisk',
      key: 'simulatedRisk',
      sorter: (a: { simulatedRisk: number }, b: { simulatedRisk: number }) =>
        a.simulatedRisk - b.simulatedRisk,
      render: (v: number) => `${v}%`,
    },
    {
      title: 'Change',
      dataIndex: 'delta',
      key: 'delta',
      defaultSortOrder: 'ascend' as const,
      sorter: (a: { delta: number }, b: { delta: number }) => a.delta - b.delta,
      render: (v: number) => {
        if (v === 0) return <Tag>no change</Tag>;
        return (
          <Tag color={v < 0 ? 'green' : 'red'}>
            {v < 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />} {Math.abs(v)} pts
          </Tag>
        );
      },
    },
  ];

  return (
    <div>
      <Title level={3}>Simulation</Title>
      <Paragraph type="secondary">
        Adjust the levers and re-run the model to see how team risk would respond.
        Nothing is saved — this does not change employee records or create a
        report.
      </Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card
            title="Scenario"
            extra={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={reset}
                disabled={!hasChanges && !result}
              >
                Reset
              </Button>
            }
          >
            {loadingTeams ? (
              <Skeleton active paragraph={{ rows: 8 }} />
            ) : teams.length === 0 ? (
              <Empty description="No teams available" />
            ) : (
              <>
                <Text strong>Team</Text>
                <Select
                  style={{ width: '100%', marginTop: 8, marginBottom: 16 }}
                  value={teamId}
                  onChange={(v) => {
                    setTeamId(v);
                    setResult(null);
                  }}
                  options={teams.map((t) => ({
                    label: `${t.name} (${t.department})`,
                    value: t.id,
                  }))}
                />

                <Divider style={{ margin: '12px 0' }} />

                {LEVERS.map((lever) => (
                  <div key={lever.key} style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                      }}
                    >
                      <Text>{lever.label}</Text>
                      <Text
                        strong
                        type={
                          adjustments[lever.key] === 0 ? 'secondary' : undefined
                        }
                      >
                        {adjustments[lever.key] > 0 ? '+' : ''}
                        {adjustments[lever.key]}
                        {lever.suffix}
                      </Text>
                    </div>
                    <Slider
                      min={lever.min}
                      max={lever.max}
                      step={lever.step}
                      value={adjustments[lever.key]}
                      onChange={(v) =>
                        setAdjustments((prev) => ({ ...prev, [lever.key]: v }))
                      }
                      marks={{ 0: '0' }}
                      tooltip={{ formatter: (v) => `${v}${lever.suffix}` }}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {lever.hint}
                    </Text>
                  </div>
                ))}

                <Button
                  type="primary"
                  block
                  icon={<ExperimentOutlined />}
                  loading={running}
                  onClick={run}
                  disabled={!teamId}
                  style={{ marginTop: 8 }}
                >
                  {hasChanges ? 'Run simulation' : 'Run baseline'}
                </Button>
                {!hasChanges && (
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: 'block', marginTop: 8 }}
                  >
                    With every lever at zero, the simulated result matches the
                    baseline — move a slider to see a difference.
                  </Text>
                )}
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          {running ? (
            <Card>
              <Skeleton active paragraph={{ rows: 10 }} />
            </Card>
          ) : !result ? (
            <Card>
              <Empty description="Run a simulation to see projected impact" />
            </Card>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              <Card title={`Projected impact — ${result.teamName}`}>
                <Row gutter={[16, 16]}>
                  <Col xs={12} sm={8}>
                    <Statistic
                      title="Current risk"
                      value={result.baseline.riskScore}
                      suffix="%"
                    />
                  </Col>
                  <Col xs={12} sm={8}>
                    <Statistic
                      title="Simulated risk"
                      value={result.simulated.riskScore}
                      suffix="%"
                      valueStyle={{
                        color: improved
                          ? RISK_COLORS.LOW
                          : delta > 0
                            ? RISK_COLORS.HIGH
                            : undefined,
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Statistic
                      title="Change"
                      value={Math.abs(delta)}
                      suffix="pts"
                      prefix={
                        delta === 0 ? null : improved ? (
                          <ArrowDownOutlined />
                        ) : (
                          <ArrowUpOutlined />
                        )
                      }
                      valueStyle={{
                        color: improved
                          ? RISK_COLORS.LOW
                          : delta > 0
                            ? RISK_COLORS.HIGH
                            : undefined,
                      }}
                    />
                  </Col>
                </Row>

                {delta === 0 && hasChanges && (
                  <Alert
                    style={{ marginTop: 16 }}
                    type="info"
                    showIcon
                    message="No net change at team level"
                    description="Individual employees may still have moved — check the table below."
                  />
                )}
              </Card>

              <Card title="Risk distribution">
                <Row gutter={16}>
                  {(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => {
                    const before = result.baseline.distribution[level] ?? 0;
                    const after = result.simulated.distribution[level] ?? 0;
                    const diff = after - before;
                    return (
                      <Col xs={8} key={level}>
                        <Statistic
                          title={level}
                          value={after}
                          suffix={
                            diff === 0 ? undefined : (
                              <Text
                                style={{ fontSize: 14 }}
                                type={
                                  (level === 'HIGH' && diff < 0) ||
                                  (level === 'LOW' && diff > 0)
                                    ? 'success'
                                    : 'danger'
                                }
                              >
                                ({diff > 0 ? '+' : ''}
                                {diff})
                              </Text>
                            )
                          }
                          valueStyle={{ color: RISK_COLORS[level] }}
                        />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          was {before}
                        </Text>
                      </Col>
                    );
                  })}
                </Row>
              </Card>

              <Card
                title={`Per-employee impact (${result.employeeCount})`}
                styles={{ body: { padding: 0 } }}
              >
                <Table
                  size="small"
                  columns={employeeColumns}
                  dataSource={result.employees}
                  rowKey="id"
                  scroll={{ x: 520 }}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                />
              </Card>
            </Space>
          )}
        </Col>
      </Row>
    </div>
  );
}
