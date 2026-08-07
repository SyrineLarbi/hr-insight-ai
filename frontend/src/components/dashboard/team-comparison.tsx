'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  Select,
  Row,
  Col,
  Table,
  Tag,
  Typography,
  Skeleton,
  Empty,
  Alert,
  message,
} from 'antd';
import api from '@/lib/api';
import type { TeamSummary, TeamComparison, ComparisonMetric } from '@/types';
import { extractApiError } from '@/lib/errors';

const { Text } = Typography;

function formatValue(metric: string, value: number): string {
  if (metric === 'riskScore') return `${value}%`;
  if (metric === 'overtimeHours') return `${value} h`;
  if (metric === 'absenteeismDays') return `${value} d`;
  if (metric === 'lastPromotionMonths') return `${value} mo`;
  return value.toFixed(1);
}

export default function TeamComparisonCard({ teams }: { teams: TeamSummary[] }) {
  const [teamA, setTeamA] = useState<string | undefined>(teams[0]?.id);
  const [teamB, setTeamB] = useState<string | undefined>(teams[1]?.id);
  const [data, setData] = useState<TeamComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamA || !teamB || teamA === teamB) {
      setData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: res } = await api.get<TeamComparison>(
          `/analytics/compare?teamA=${teamA}&teamB=${teamB}`,
        );
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(extractApiError(err, 'Comparison failed'));
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // A fast re-select must not let an older response overwrite a newer one.
    return () => {
      cancelled = true;
    };
  }, [teamA, teamB]);

  if (teams.length < 2) {
    return (
      <Card title="Team comparison">
        <Empty description="At least two teams are needed to compare" />
      </Card>
    );
  }

  const columns = [
    { title: 'Metric', dataIndex: 'label', key: 'label' },
    {
      title: data?.teamA.name ?? 'Team A',
      key: 'valueA',
      render: (_: unknown, r: ComparisonMetric) => (
        <Text strong={r.better === 'a'} type={r.better === 'a' ? 'success' : undefined}>
          {formatValue(r.metric, r.valueA)}
        </Text>
      ),
    },
    {
      title: data?.teamB.name ?? 'Team B',
      key: 'valueB',
      render: (_: unknown, r: ComparisonMetric) => (
        <Text strong={r.better === 'b'} type={r.better === 'b' ? 'success' : undefined}>
          {formatValue(r.metric, r.valueB)}
        </Text>
      ),
    },
    {
      title: 'Gap',
      key: 'difference',
      render: (_: unknown, r: ComparisonMetric) => {
        if (r.better === 'tie') return <Tag>tie</Tag>;
        const leader = r.better === 'a' ? data?.teamA.name : data?.teamB.name;
        return (
          <Tag color="blue">
            {Math.abs(r.difference)} — {leader} ahead
          </Tag>
        );
      },
    },
  ];

  return (
    <Card title="Team comparison">
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Team A
          </Text>
          <Select
            style={{ width: '100%' }}
            value={teamA}
            onChange={setTeamA}
            options={teams.map((t) => ({
              label: t.name,
              value: t.id,
              disabled: t.id === teamB,
            }))}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Team B
          </Text>
          <Select
            style={{ width: '100%' }}
            value={teamB}
            onChange={setTeamB}
            options={teams.map((t) => ({
              label: t.name,
              value: t.id,
              disabled: t.id === teamA,
            }))}
          />
        </Col>
      </Row>

      {error ? (
        <Alert type="warning" showIcon message={error} />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : !data ? (
        <Empty description="Pick two different teams" />
      ) : (
        <>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {data.teamA.name} has {data.teamA.employeeCount} employees;{' '}
            {data.teamB.name} has {data.teamB.employeeCount}. Risk score comes
            from each team&apos;s most recent completed report.
          </Text>
          <Table
            style={{ marginTop: 12 }}
            size="small"
            columns={columns}
            dataSource={data.metrics}
            rowKey="metric"
            pagination={false}
            scroll={{ x: 520 }}
          />
        </>
      )}
    </Card>
  );
}
