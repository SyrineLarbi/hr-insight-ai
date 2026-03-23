# Phase 7 - Step 4: Dashboard Page — Generate Insight + Analytics

## Why Are We Doing This?

The dashboard is the **heart of the platform** — it's where HR professionals turn raw data into actionable intelligence. A user selects a team, picks a date range, clicks "Generate Insight," and watches real-time progress as the system:

1. Fetches employee data → 2. Runs ML predictions → 3. Generates LLM summary → 4. Displays results

This page combines: team analytics (charts), report generation (WebSocket progress), risk display (color-coded), executive summary (markdown), and action plans (cards).

---

## What We're Building

```
frontend/src/
  app/(dashboard)/dashboard/page.tsx   ← REWRITE: full dashboard with all components
  components/
    dashboard/
      team-selector.tsx                ← Team dropdown + date range picker
      generate-button.tsx              ← Generate Insight button + WebSocket progress
      risk-score-card.tsx              ← Circular progress with risk color
      executive-summary.tsx            ← Markdown renderer for LLM output
      action-plan-cards.tsx            ← Structured action plan display
      team-analytics-charts.tsx        ← Bar/Radar charts for team metrics
```

---

## The Steps

### Step A: Create the TeamSelector component

Create `frontend/src/components/dashboard/team-selector.tsx`:

```typescript
'use client';

import { Select, DatePicker, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import api from '@/lib/api';
import type { Team } from '@/types';

const { RangePicker } = DatePicker;
const { Text } = Typography;

interface TeamSelectorProps {
  onTeamChange: (teamId: string) => void;
  onDateRangeChange: (dates: [string, string]) => void;
  selectedTeamId: string | null;
}

export default function TeamSelector({
  onTeamChange,
  onDateRangeChange,
  selectedTeamId,
}: TeamSelectorProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Team[]>('/teams').then(({ data }) => {
      setTeams(data);
      setLoading(false);
    });
  }, []);

  const handleDateChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (dates && dates[0] && dates[1]) {
      onDateRangeChange([
        dates[0].toISOString(),
        dates[1].toISOString(),
      ]);
    }
  };

  return (
    <Space wrap size="middle">
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Team
        </Text>
        <Select
          placeholder="Select a team"
          loading={loading}
          value={selectedTeamId}
          onChange={onTeamChange}
          style={{ width: 280 }}
          options={teams.map((t) => ({
            label: `${t.name} (${t._count?.employees ?? 0} employees)`,
            value: t.id,
          }))}
        />
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          Date Range
        </Text>
        <RangePicker
          defaultValue={[dayjs().subtract(30, 'day'), dayjs()]}
          onChange={handleDateChange}
        />
      </div>
    </Space>
  );
}
```

---

### Step B: Create the RiskScoreCard component

Create `frontend/src/components/dashboard/risk-score-card.tsx`:

```typescript
'use client';

import { Card, Progress, Typography, Space } from 'antd';
import { getRiskLevel, RISK_COLORS, RISK_LABELS } from '@/lib/constants';

const { Text, Title } = Typography;

interface RiskScoreCardProps {
  score: number | null; // 0–1
}

export default function RiskScoreCard({ score }: RiskScoreCardProps) {
  if (score === null) {
    return (
      <Card>
        <Text type="secondary">No risk score available</Text>
      </Card>
    );
  }

  const level = getRiskLevel(score);
  const percent = Math.round(score * 100);

  return (
    <Card>
      <Space direction="vertical" align="center" style={{ width: '100%' }}>
        <Progress
          type="circle"
          percent={percent}
          strokeColor={RISK_COLORS[level]}
          format={() => `${percent}%`}
          size={120}
        />
        <Title level={4} style={{ margin: 0, color: RISK_COLORS[level] }}>
          {RISK_LABELS[level]}
        </Title>
        <Text type="secondary">Team Attrition Risk Score</Text>
      </Space>
    </Card>
  );
}
```

---

### Step C: Create the ExecutiveSummary component

Create `frontend/src/components/dashboard/executive-summary.tsx`:

```typescript
'use client';

import { Card, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';

const { Title } = Typography;

interface ExecutiveSummaryProps {
  summary: string | null;
}

export default function ExecutiveSummary({ summary }: ExecutiveSummaryProps) {
  if (!summary) return null;

  return (
    <Card>
      <Title level={4}>Executive Summary</Title>
      <div className="markdown-content">
        <ReactMarkdown>{summary}</ReactMarkdown>
      </div>
    </Card>
  );
}
```

---

### Step D: Create the ActionPlanCards component

Create `frontend/src/components/dashboard/action-plan-cards.tsx`:

```typescript
'use client';

import { Card, Tag, Typography, Space, List } from 'antd';
import type { ActionPlan } from '@/types';

const { Title, Text } = Typography;

interface ActionPlanCardsProps {
  actionPlans: ActionPlan[];
}

export default function ActionPlanCards({ actionPlans }: ActionPlanCardsProps) {
  if (!actionPlans || actionPlans.length === 0) return null;

  return (
    <Card>
      <Title level={4}>Action Plans</Title>
      <List
        dataSource={actionPlans}
        renderItem={(plan) => {
          const json = plan.planJson as Record<string, unknown>;
          const items = (json.actions ?? json.recommendations ?? []) as Array<{
            title?: string;
            description?: string;
            priority?: string;
          }>;

          return (
            <Card
              size="small"
              style={{ marginBottom: 12 }}
              extra={
                plan.projectedRoi ? (
                  <Tag color="green">ROI: ${plan.projectedRoi.toLocaleString()}</Tag>
                ) : null
              }
            >
              {Array.isArray(items) ? (
                <List
                  size="small"
                  dataSource={items}
                  renderItem={(item, idx) => (
                    <List.Item key={idx}>
                      <Space direction="vertical" size={0}>
                        <Text strong>{item.title ?? `Action ${idx + 1}`}</Text>
                        {item.description && (
                          <Text type="secondary">{item.description}</Text>
                        )}
                        {item.priority && (
                          <Tag
                            color={
                              item.priority === 'HIGH'
                                ? 'red'
                                : item.priority === 'MEDIUM'
                                  ? 'orange'
                                  : 'blue'
                            }
                          >
                            {item.priority}
                          </Tag>
                        )}
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <pre style={{ fontSize: 12, overflow: 'auto' }}>
                  {JSON.stringify(json, null, 2)}
                </pre>
              )}
            </Card>
          );
        }}
      />
    </Card>
  );
}
```

---

### Step E: Create the TeamAnalyticsCharts component

Create `frontend/src/components/dashboard/team-analytics-charts.tsx`:

```typescript
'use client';

import { Card, Row, Col, Statistic, Typography, Progress, Space } from 'antd';
import type { TeamAnalytics } from '@/types';

const { Title, Text } = Typography;

interface TeamAnalyticsChartsProps {
  analytics: TeamAnalytics | null;
}

export default function TeamAnalyticsCharts({ analytics }: TeamAnalyticsChartsProps) {
  if (!analytics || !analytics.averages) return null;

  const { averages, distributions, riskIndicators, employeeCount } = analytics;

  const riskBar = (label: string, value: number) => (
    <div style={{ marginBottom: 12 }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Text>{label}</Text>
        <Text strong>{value}%</Text>
      </Space>
      <Progress
        percent={value}
        showInfo={false}
        strokeColor={value > 50 ? '#ff4d4f' : value > 30 ? '#faad14' : '#52c41a'}
        size="small"
      />
    </div>
  );

  return (
    <div>
      <Title level={4}>Team Analytics — {analytics.teamName}</Title>

      {/* Key Metrics */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Employees" value={employeeCount} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Avg Salary" value={averages.salary} prefix="$" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Avg Engagement" value={averages.engagementScore} suffix="/5" precision={1} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Avg Performance" value={averages.performanceScore} suffix="/5" precision={1} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Avg Overtime" value={averages.overtimeHours} suffix="h/wk" precision={1} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Avg Tenure" value={averages.tenureMonths} suffix="mo" precision={0} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* Distributions */}
        {distributions && (
          <Col xs={24} lg={12}>
            <Card title="Score Distributions" size="small">
              <Row gutter={16}>
                <Col span={12}>
                  <Text strong>Engagement</Text>
                  <div style={{ marginTop: 8 }}>
                    <Tag color="red">Low: {distributions.engagement.low}</Tag>
                    <Tag color="orange">Mid: {distributions.engagement.medium}</Tag>
                    <Tag color="green">High: {distributions.engagement.high}</Tag>
                  </div>
                </Col>
                <Col span={12}>
                  <Text strong>Performance</Text>
                  <div style={{ marginTop: 8 }}>
                    <Tag color="red">Low: {distributions.performance.low}</Tag>
                    <Tag color="orange">Mid: {distributions.performance.medium}</Tag>
                    <Tag color="green">High: {distributions.performance.high}</Tag>
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>
        )}

        {/* Risk Indicators */}
        {riskIndicators && (
          <Col xs={24} lg={12}>
            <Card title="Risk Indicators" size="small">
              {riskBar('High Overtime (>10h/wk)', riskIndicators.pctHighOvertime)}
              {riskBar('Low Engagement (<3.0)', riskIndicators.pctLowEngagement)}
              {riskBar('Low Performance (<3.0)', riskIndicators.pctLowPerformance)}
              {riskBar('No Promotion >24mo', riskIndicators.pctLongWithoutPromotion)}
              {riskBar('High Absenteeism (>10d)', riskIndicators.pctHighAbsenteeism)}
            </Card>
          </Col>
        )}
      </Row>
    </div>
  );
}
```

---

### Step F: Rewrite the Dashboard page

Replace `frontend/src/app/(dashboard)/dashboard/page.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Typography, Row, Col, Divider, Empty, Button, Card, Steps, Spin } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '@/contexts/auth-context';
import api from '@/lib/api';
import type { Report, TeamAnalytics } from '@/types';
import TeamSelector from '@/components/dashboard/team-selector';
import RiskScoreCard from '@/components/dashboard/risk-score-card';
import ExecutiveSummary from '@/components/dashboard/executive-summary';
import ActionPlanCards from '@/components/dashboard/action-plan-cards';
import TeamAnalyticsCharts from '@/components/dashboard/team-analytics-charts';

const { Title, Text } = Typography;

export default function DashboardPage() {
  const { user, role } = useAuth();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[string, string]>([
    dayjs().subtract(30, 'day').toISOString(),
    dayjs().toISOString(),
  ]);
  const [analytics, setAnalytics] = useState<TeamAnalytics | null>(null);
  const [latestReport, setLatestReport] = useState<Report | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // Load team analytics when team changes
  useEffect(() => {
    if (!selectedTeamId) return;

    setLoadingAnalytics(true);
    api
      .get<TeamAnalytics>(`/analytics/team/${selectedTeamId}`)
      .then(({ data }) => setAnalytics(data))
      .catch(() => setAnalytics(null))
      .finally(() => setLoadingAnalytics(false));
  }, [selectedTeamId]);

  // Check for latest report for the selected team
  useEffect(() => {
    if (!selectedTeamId) return;

    api
      .get<Report[]>(`/reports?teamId=${selectedTeamId}&limit=1`)
      .then(({ data }) => setLatestReport(data[0] ?? null))
      .catch(() => setLatestReport(null));
  }, [selectedTeamId]);

  const canGenerate = role === 'ADMIN' || role === 'HR_MANAGER' || role === 'TEAM_MANAGER';

  return (
    <div>
      <Title level={3}>Dashboard</Title>
      <Text type="secondary">
        Welcome, {user?.firstName}. Select a team to view analytics
        {canGenerate ? ' or generate an insight report.' : '.'}
      </Text>

      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <TeamSelector
          selectedTeamId={selectedTeamId}
          onTeamChange={setSelectedTeamId}
          onDateRangeChange={setDateRange}
        />
      </div>

      {!selectedTeamId ? (
        <Empty description="Select a team to get started" />
      ) : loadingAnalytics ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* Team Analytics */}
          <TeamAnalyticsCharts analytics={analytics} />

          <Divider />

          {/* Generate Report button (when Phases 5+6 are ready) */}
          {canGenerate && (
            <Card style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                size="large"
                icon={<ThunderboltOutlined />}
                disabled
              >
                Generate Insight Report
              </Button>
              <Text type="secondary" style={{ marginLeft: 12 }}>
                Available after Phase 6 (ML + LLM pipeline)
              </Text>
            </Card>
          )}

          {/* Latest Report Display */}
          {latestReport && (
            <>
              <Row gutter={16}>
                <Col xs={24} sm={8}>
                  <RiskScoreCard score={latestReport.riskScore} />
                </Col>
                <Col xs={24} sm={16}>
                  <ExecutiveSummary summary={latestReport.summaryText} />
                </Col>
              </Row>
              {latestReport.actionPlans && (
                <div style={{ marginTop: 16 }}>
                  <ActionPlanCards actionPlans={latestReport.actionPlans} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
```

**Note:** The "Generate Insight Report" button is disabled until Phase 6 (Reports + WebSocket pipeline) is complete. When that's ready, you'll connect it to the WebSocket gateway for real-time progress. The button and progress bar logic will be uncommented/enabled at that time.

---

## How to Verify It Worked

1. Login as ADMIN → Dashboard shows team selector + date range picker
2. Select a team → analytics load (6 metric cards, distributions, risk bars)
3. Risk indicator bars are color-coded (green < 30%, amber 30-50%, red > 50%)
4. Distribution tags sum to employee count
5. "Generate Insight Report" button visible for ADMIN/HR_MANAGER/TEAM_MANAGER, disabled
6. Login as VIEWER → button not visible

---

## Checklist

- [ ] `team-selector.tsx` — loads teams, shows employee count
- [ ] `risk-score-card.tsx` — circular progress with color
- [ ] `executive-summary.tsx` — renders markdown
- [ ] `action-plan-cards.tsx` — renders structured plans
- [ ] `team-analytics-charts.tsx` — metric cards, distributions, risk bars
- [ ] Dashboard page loads analytics on team selection
- [ ] Works for all 4 roles (VIEWER can't see generate button)

---

Once confirmed, move to **Step 5: Teams & Employees Pages** — CRUD tables with modals for create/edit/delete.
