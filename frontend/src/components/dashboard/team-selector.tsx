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

export default function TeamSelector({ onTeamChange, onDateRangeChange, selectedTeamId }: TeamSelectorProps) {
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
      onDateRangeChange([dates[0].toISOString(), dates[1].toISOString()]);
    }
  };

  return (
    <Space wrap size="middle">
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Team</Text>
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
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Date Range</Text>
        <RangePicker defaultValue={[dayjs().subtract(30, 'day'), dayjs()]} onChange={handleDateChange} />
      </div>
    </Space>
  );
}
