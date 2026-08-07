'use client';

import { useEffect, useState } from 'react';
import { Card, Typography, Skeleton, Empty, Tooltip, Space, message } from 'antd';
import Link from 'next/link';
import api from '@/lib/api';
import type { HeatmapRow } from '@/types';
import { extractApiError } from '@/lib/errors';

const { Text } = Typography;

/**
 * Colour ramp: green (best) → amber → red (worst).
 *
 * Interpolated in RGB rather than picked from discrete buckets, so a team that
 * is marginally worse reads as marginally darker instead of jumping a category.
 */
function intensityColor(intensity: number): string {
  const clamped = Math.min(1, Math.max(0, intensity));

  // Two-stop ramp through amber so mid values stay legible against black text.
  const stops: Array<[number, [number, number, number]]> = [
    [0, [82, 196, 26]], // #52c41a
    [0.5, [250, 173, 20]], // #faad14
    [1, [255, 77, 79]], // #ff4d4f
  ];

  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i][0] && clamped <= stops[i + 1][0]) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const span = upper[0] - lower[0];
  const t = span === 0 ? 0 : (clamped - lower[0]) / span;
  const rgb = lower[1].map((c, i) => Math.round(c + (upper[1][i] - c) * t));

  // Alpha keeps the grid readable in dark mode without a second palette.
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.85)`;
}

function formatValue(metric: string, value: number): string {
  if (metric === 'riskScore') return `${value}%`;
  if (metric === 'overtimeHours') return `${value}h`;
  if (metric === 'absenteeismDays') return `${value}d`;
  if (metric === 'lastPromotionMonths') return `${value}mo`;
  return value.toFixed(1);
}

export default function RiskHeatmap() {
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<HeatmapRow[]>('/analytics/heatmap');
        setRows(data);
      } catch (err) {
        message.error(extractApiError(err, 'Failed to load heatmap'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <Card title="Risk heatmap">
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card title="Risk heatmap">
        <Empty description="No teams with employees to compare" />
      </Card>
    );
  }

  const metrics = rows[0].cells;

  return (
    <Card
      title="Risk heatmap"
      extra={
        <Space size={4}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            best
          </Text>
          <span
            style={{
              display: 'inline-block',
              width: 60,
              height: 10,
              borderRadius: 2,
              background:
                'linear-gradient(to right, rgba(82,196,26,.85), rgba(250,173,20,.85), rgba(255,77,79,.85))',
            }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            worst
          </Text>
        </Space>
      }
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        Colours are relative to the other teams shown, not to a fixed threshold.
      </Text>

      {/* Wide grid must scroll inside the card, never widen the page. */}
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 2, minWidth: 640 }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '4px 8px',
                  fontWeight: 500,
                  fontSize: 12,
                  position: 'sticky',
                  left: 0,
                  background: 'var(--ant-color-bg-container, #fff)',
                }}
              >
                Team
              </th>
              {metrics.map((m) => (
                <th
                  key={m.metric}
                  style={{
                    padding: '4px 8px',
                    fontWeight: 500,
                    fontSize: 12,
                    minWidth: 92,
                  }}
                >
                  {m.label}
                  <div style={{ fontWeight: 400, opacity: 0.6, fontSize: 10 }}>
                    {m.worseWhen === 'higher' ? 'lower is better' : 'higher is better'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.teamId}>
                <td
                  style={{
                    padding: '4px 8px',
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--ant-color-bg-container, #fff)',
                  }}
                >
                  <Link href={`/teams/${row.teamId}`}>{row.teamName}</Link>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    {row.employeeCount} employees
                  </div>
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.metric} style={{ padding: 0 }}>
                    <Tooltip
                      title={`${row.teamName} — ${cell.label}: ${formatValue(
                        cell.metric,
                        cell.value,
                      )}`}
                    >
                      <div
                        style={{
                          background: intensityColor(cell.intensity),
                          borderRadius: 4,
                          padding: '10px 8px',
                          textAlign: 'center',
                          color: '#1f1f1f',
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: 'default',
                        }}
                      >
                        {formatValue(cell.metric, cell.value)}
                      </div>
                    </Tooltip>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
