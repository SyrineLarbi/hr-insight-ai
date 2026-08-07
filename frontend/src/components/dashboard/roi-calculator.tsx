'use client';

import { useMemo, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Slider,
  InputNumber,
  Statistic,
  Typography,
  Alert,
  Empty,
  Divider,
  Tooltip,
} from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import {
  calculateRoi,
  DEFAULT_ASSUMPTIONS,
  formatCurrencyExact,
  type RoiAssumptions,
} from '@/lib/roi';

const { Text, Paragraph } = Typography;

interface RoiCalculatorProps {
  /** Employees in scope, with the risk score from the latest prediction (0-1). */
  employees: Array<{ salary: number; riskScore: number }>;
  teamName?: string;
}

export default function RoiCalculator({ employees, teamName }: RoiCalculatorProps) {
  const [assumptions, setAssumptions] = useState<RoiAssumptions>(DEFAULT_ASSUMPTIONS);

  const result = useMemo(
    () => calculateRoi({ employees, assumptions }),
    [employees, assumptions],
  );

  if (employees.length === 0) {
    return (
      <Card title="ROI calculator">
        <Empty description="Generate a report first — the calculator needs risk scores" />
      </Card>
    );
  }

  const set = <K extends keyof RoiAssumptions>(key: K, value: RoiAssumptions[K]) =>
    setAssumptions((prev) => ({ ...prev, [key]: value }));

  const profitable = result.netSavings > 0;

  return (
    <Card
      title="ROI calculator"
      extra={
        <Tooltip title="Every figure below is derived from the assumptions you set — change them to test your own numbers.">
          <InfoCircleOutlined />
        </Tooltip>
      }
    >
      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
        Estimated value of a retention programme for{' '}
        {teamName ? <Text strong>{teamName}</Text> : 'this group'} (
        {result.headcount} employees). Cost is risk-weighted: someone at 55% risk
        contributes 55% of their replacement cost, not all or nothing.
      </Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Text strong>Replacement cost</Text>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {assumptions.replacementCostMultiplier.toFixed(2)}× annual salary
            </Text>
          </div>
          <Slider
            min={0.5}
            max={3}
            step={0.05}
            value={assumptions.replacementCostMultiplier}
            onChange={(v) => set('replacementCostMultiplier', v)}
            marks={{ 1.5: '1.5×', 2: '2×' }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            Industry norm is 1.5×–2× once hiring, onboarding, and lost
            productivity are counted.
          </Text>
        </Col>

        <Col xs={24} md={12}>
          <Text strong>Intervention success rate</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {Math.round(assumptions.interventionSuccessRate * 100)}% of at-risk
              employees retained
            </Text>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={assumptions.interventionSuccessRate}
            onChange={(v) => set('interventionSuccessRate', v)}
            marks={{ 0.35: '35%', 0.7: '70%' }}
            tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            Be conservative — programmes rarely save everyone they target.
          </Text>
        </Col>

        <Col xs={24} md={12}>
          <Text strong>Programme cost (annual)</Text>
          <InputNumber
            style={{ width: '100%', marginTop: 4 }}
            min={0}
            step={5000}
            value={assumptions.programmeCost}
            onChange={(v) => set('programmeCost', v ?? 0)}
            formatter={(v) => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number((v ?? '').replace(/[^\d]/g, ''))}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            Salary reviews, engagement work, manager coaching, tooling.
          </Text>
        </Col>
      </Row>

      <Divider />

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Statistic
            title="Cost of doing nothing"
            value={formatCurrencyExact(result.expectedTurnoverCost)}
            valueStyle={{ fontSize: 20 }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            risk-weighted exposure
          </Text>
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="Avoidable"
            value={formatCurrencyExact(result.avoidableCost)}
            valueStyle={{ fontSize: 20 }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            at {Math.round(assumptions.interventionSuccessRate * 100)}% success
          </Text>
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="Net savings"
            value={formatCurrencyExact(result.netSavings)}
            valueStyle={{
              fontSize: 20,
              color: profitable ? '#52c41a' : '#ff4d4f',
            }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            after programme cost
          </Text>
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="Return"
            value={result.roiPercent === null ? '—' : `${result.roiPercent}%`}
            valueStyle={{
              fontSize: 20,
              color: profitable ? '#52c41a' : '#ff4d4f',
            }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {result.breakEvenMonths === null
              ? 'no break-even'
              : `break-even ~${result.breakEvenMonths} mo`}
          </Text>
        </Col>
      </Row>

      {!profitable && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message="Programme costs more than it saves under these assumptions"
          description="Either the programme budget is too high for this team's exposure, or the success rate assumption is too pessimistic. Scale the programme to the risk you actually have."
        />
      )}

      <Text
        type="secondary"
        style={{ fontSize: 11, display: 'block', marginTop: 16 }}
      >
        Average exposure per employee:{' '}
        {formatCurrencyExact(result.costPerEmployee)}. These are estimates from
        model probabilities, not commitments — treat them as a sizing exercise.
      </Text>
    </Card>
  );
}
