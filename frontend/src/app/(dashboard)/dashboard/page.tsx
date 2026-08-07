'use client';

import { useState, useEffect } from 'react';
import { Typography, Divider, Empty, Skeleton, Alert, Space, message } from 'antd';
import dayjs from 'dayjs';
import { useAuth } from '@/contexts/auth-context';
import api from '@/lib/api';
import type { TeamAnalytics, TeamSummary } from '@/types';
import TeamSelector from '@/components/dashboard/team-selector';
import TeamAnalyticsCharts from '@/components/dashboard/team-analytics-charts';
import RiskHeatmap from '@/components/dashboard/risk-heatmap';
import TeamComparisonCard from '@/components/dashboard/team-comparison';
import { extractApiError } from '@/lib/errors';

const { Title, Text } = Typography;

export default function DashboardPage() {
  const { user } = useAuth();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [, setDateRange] = useState<[string, string]>([
    dayjs().subtract(30, 'day').toISOString(),
    dayjs().toISOString(),
  ]);
  const [analytics, setAnalytics] = useState<TeamAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [teams, setTeams] = useState<TeamSummary[]>([]);

  // Loaded once for the comparison card, which needs the full visible team list.
  useEffect(() => {
    api
      .get<TeamSummary[]>('/teams')
      .then(({ data }) => setTeams(data))
      .catch((err) => message.error(extractApiError(err, 'Failed to load teams')));
  }, []);

  useEffect(() => {
    if (!selectedTeamId) return;

    let cancelled = false;
    setLoadingAnalytics(true);
    setAnalyticsError(null);

    api
      .get<TeamAnalytics>(`/analytics/team/${selectedTeamId}`)
      .then(({ data }) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setAnalytics(null);
          setAnalyticsError(extractApiError(err, 'Failed to load team analytics'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAnalytics(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTeamId]);

  return (
    <div>
      <Title level={3}>Dashboard</Title>
      <Text type="secondary">
        Welcome, {user?.firstName}. Select a team for detail, or use the heatmap
        below to see where risk is concentrated.
      </Text>

      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <TeamSelector
          selectedTeamId={selectedTeamId}
          onTeamChange={setSelectedTeamId}
          onDateRangeChange={setDateRange}
        />
      </div>

      {!selectedTeamId ? (
        <Empty description="Select a team to see its analytics" />
      ) : loadingAnalytics ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : analyticsError ? (
        <Alert type="warning" showIcon message={analyticsError} />
      ) : (
        <TeamAnalyticsCharts analytics={analytics} />
      )}

      <Divider />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <RiskHeatmap />
        <TeamComparisonCard teams={teams} />
      </Space>
    </div>
  );
}
