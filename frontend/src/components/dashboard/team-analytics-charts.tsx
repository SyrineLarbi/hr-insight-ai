'use client';

import { Card, Row, Col, Statistic, Typography, Progress, Space, Tag } from 'antd';
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
      <Space style={{ justifyContent: 'space-between', width: '100%', display: 'flex' }}>
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
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="Employees" value={employeeCount} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="Avg Salary" value={averages.salary} prefix="$" precision={0} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="Avg Engagement" value={averages.engagementScore} suffix="/5" precision={1} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="Avg Performance" value={averages.performanceScore} suffix="/5" precision={1} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="Avg Overtime" value={averages.overtimeHours} suffix="h/wk" precision={1} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="Avg Tenure" value={averages.tenureMonths} suffix="mo" precision={0} /></Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
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
