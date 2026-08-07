import type { Role, RiskLevel } from '@/types';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  HR_MANAGER: 'HR Manager',
  TEAM_MANAGER: 'Team Manager',
  VIEWER: 'Viewer',
};

export const ROLE_COLORS: Record<Role, string> = {
  ADMIN: 'red',
  HR_MANAGER: 'purple',
  TEAM_MANAGER: 'blue',
  VIEWER: 'default',
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: '#52c41a',
  MEDIUM: '#faad14',
  HIGH: '#ff4d4f',
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  LOW: 'Low Risk',
  MEDIUM: 'Medium Risk',
  HIGH: 'High Risk',
};

export function getRiskLevel(score: number): RiskLevel {
  if (score < 0.3) return 'LOW';
  if (score < 0.6) return 'MEDIUM';
  return 'HIGH';
}
