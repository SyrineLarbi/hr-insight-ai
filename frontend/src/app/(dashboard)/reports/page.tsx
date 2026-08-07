'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Table,
  Tag,
  Empty,
  Button,
  Modal,
  Select,
  DatePicker,
  Space,
  Progress,
  Result,
  message,
} from 'antd';
import { PlusOutlined, FilePdfOutlined, EyeOutlined } from '@ant-design/icons';
import Link from 'next/link';
import dayjs, { type Dayjs } from 'dayjs';
import api from '@/lib/api';
import type { Report, Team, Role } from '@/types';
import { getRiskLevel, RISK_COLORS, RISK_LABELS } from '@/lib/constants';
import { useAuth } from '@/contexts/auth-context';
import { useReportProgress } from '@/hooks/use-report-progress';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'green',
  GENERATING: 'blue',
  FAILED: 'red',
};

const CAN_GENERATE: Role[] = ['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER'];

function toPercent(score: number | null): number | null {
  if (score == null) return null;
  return score <= 1 ? Math.round(score * 100) : Math.round(score);
}

export default function ReportsPage() {
  const { role } = useAuth();
  const canGenerate = role ? CAN_GENERATE.includes(role) : false;

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);

  const { state, start, reset } = useReportProgress();

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Report[]>('/reports');
      setReports(data);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const openModal = async () => {
    setModalOpen(true);
    if (teams.length === 0) {
      try {
        const { data } = await api.get<Team[]>('/teams');
        setTeams(data);
        if (data.length === 1) setTeamId(data[0].id);
      } catch {
        message.error('Failed to load teams');
      }
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    reset();
  };

  const handleGenerate = async () => {
    if (!teamId) {
      message.warning('Please select a team');
      return;
    }
    start();
    try {
      await api.post('/reports/generate', {
        teamId,
        dateRangeStart: dateRange[0].toISOString(),
        dateRangeEnd: dateRange[1].toISOString(),
      });
      // The WebSocket will report progress and fire complete/error.
      // The POST resolves only after the full pipeline finishes.
      await loadReports();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Report generation failed';
      message.error(msg);
    }
  };

  const handleExportPdf = async (reportId: string) => {
    try {
      const response = await api.get(`/reports/${reportId}/pdf`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `hr-insight-report-${reportId.slice(0, 8)}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('PDF export failed');
    }
  };

  const columns = [
    {
      title: 'Team',
      key: 'team',
      render: (_: unknown, r: Report) => r.team?.name ?? r.teamId,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <Tag color={STATUS_COLORS[s] ?? 'default'}>{s}</Tag>
      ),
    },
    {
      title: 'Risk Score',
      dataIndex: 'riskScore',
      key: 'riskScore',
      render: (score: number | null) => {
        const pct = toPercent(score);
        if (pct == null) return '—';
        const level = getRiskLevel(pct / 100);
        return (
          <Tag color={RISK_COLORS[level]}>
            {RISK_LABELS[level]} ({pct}%)
          </Tag>
        );
      },
      sorter: (a: Report, b: Report) =>
        (toPercent(a.riskScore) ?? 0) - (toPercent(b.riskScore) ?? 0),
    },
    {
      title: 'Generated',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d: string) => new Date(d).toLocaleString(),
      sorter: (a: Report, b: Report) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, r: Report) => (
        <Space>
          <Link href={`/reports/${r.id}`}>
            <Button size="small" icon={<EyeOutlined />}>
              View
            </Button>
          </Link>
          {r.status === 'COMPLETED' && (
            <Button
              size="small"
              icon={<FilePdfOutlined />}
              onClick={() => handleExportPdf(r.id)}
            >
              PDF
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          Reports
        </Title>
        {canGenerate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>
            Generate Report
          </Button>
        )}
      </div>

      {!loading && reports.length === 0 ? (
        <Empty
          description={
            canGenerate
              ? 'No reports yet. Click "Generate Report" to create one.'
              : 'No reports available.'
          }
        />
      ) : (
        <Table
          columns={columns}
          dataSource={reports}
          rowKey="id"
          loading={loading}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 10 }}
        />
      )}

      <Modal
        title="Generate Insight Report"
        open={modalOpen}
        onCancel={closeModal}
        footer={
          state.status === 'idle' ? (
            <Space>
              <Button onClick={closeModal}>Cancel</Button>
              <Button
                type="primary"
                disabled={!teamId}
                onClick={handleGenerate}
              >
                Generate
              </Button>
            </Space>
          ) : state.status === 'complete' ? (
            <Space>
              <Link href={`/reports/${state.reportId}`}>
                <Button type="primary">View Report</Button>
              </Link>
              <Button onClick={closeModal}>Close</Button>
            </Space>
          ) : state.status === 'error' ? (
            <Space>
              <Button onClick={reset}>Try Again</Button>
              <Button onClick={closeModal}>Close</Button>
            </Space>
          ) : null
        }
        width={560}
        maskClosable={state.status === 'idle' || state.status === 'complete'}
      >
        {state.status === 'idle' && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <div style={{ marginBottom: 8 }}>Team</div>
              <Select
                placeholder="Select a team"
                value={teamId}
                onChange={setTeamId}
                style={{ width: '100%' }}
                options={teams.map((t) => ({
                  label: `${t.name} — ${t.department}`,
                  value: t.id,
                }))}
              />
            </div>
            <div>
              <div style={{ marginBottom: 8 }}>Date Range</div>
              <RangePicker
                value={dateRange}
                onChange={(d) => {
                  if (d && d[0] && d[1]) setDateRange([d[0], d[1]]);
                }}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
              Generation typically takes 15–30 seconds. You&apos;ll see live
              progress below.
            </div>
          </Space>
        )}

        {state.status === 'generating' && (
          <div style={{ padding: '16px 0' }}>
            <Progress
              percent={state.progress.percentage}
              status="active"
              strokeColor={{ from: '#108ee9', to: '#87d068' }}
            />
            <div
              style={{
                marginTop: 12,
                textAlign: 'center',
                color: 'rgba(0,0,0,0.65)',
              }}
            >
              Step {state.progress.step} of {state.progress.totalSteps}:{' '}
              {state.progress.message}
            </div>
          </div>
        )}

        {state.status === 'complete' && (
          <Result
            status="success"
            title="Report generated successfully"
            subTitle="Executive summary, action plan, and risk snapshots saved."
          />
        )}

        {state.status === 'error' && (
          <Result
            status="error"
            title="Report generation failed"
            subTitle={state.message}
          />
        )}
      </Modal>
    </div>
  );
}
