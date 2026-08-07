export type Role = 'ADMIN' | 'HR_MANAGER' | 'TEAM_MANAGER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  createdAt: string;
  teamAssignments?: { team: TeamSummary }[];
  assignedTeams?: TeamSummary[];
}

export interface LoginResponse {
  user: User;
  access_token: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  department: string;
}

export interface Team extends TeamSummary {
  createdAt: string;
  updatedAt: string;
  _count?: { employees: number };
  employees?: Employee[];
}

export interface Employee {
  id: string;
  teamId: string;
  name: string;
  salary: number;
  tenureMonths: number;
  engagementScore: number;
  performanceScore: number;
  absenteeismDays: number;
  overtimeHours: number;
  lastPromotionMonths: number;
  trainingHours: number;
  createdAt: string;
  updatedAt: string;
  team?: TeamSummary;
  riskSnapshots?: RiskSnapshot[];
}

export type ReportStatus = 'GENERATING' | 'COMPLETED' | 'FAILED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Report {
  id: string;
  teamId: string;
  generatedBy: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  riskScore: number | null;
  modelVersion: string | null;
  summaryText: string | null;
  status: ReportStatus;
  createdAt: string;
  /** GET /reports/:id includes the team's employees; the list endpoint does not. */
  team?: Team;
  generatedByUser?: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>;
  actionPlans?: ActionPlan[];
}

export interface ActionPlan {
  id: string;
  reportId: string;
  planJson: Record<string, unknown>;
  projectedRoi: number | null;
  createdAt: string;
}

export interface RiskSnapshot {
  id: string;
  employeeId: string;
  riskScore: number;
  riskLevel: RiskLevel;
  modelVersion: string;
  snapshotDate: string;
}

export interface TeamAnalytics {
  teamId: string;
  teamName: string;
  department: string;
  employeeCount: number;
  averages: {
    salary: number;
    tenureMonths: number;
    engagementScore: number;
    performanceScore: number;
    absenteeismDays: number;
    overtimeHours: number;
    lastPromotionMonths: number;
    trainingHours: number;
  } | null;
  distributions: {
    engagement: { low: number; medium: number; high: number };
    performance: { low: number; medium: number; high: number };
  } | null;
  riskIndicators: {
    pctHighOvertime: number;
    pctLowEngagement: number;
    pctLowPerformance: number;
    pctLongWithoutPromotion: number;
    pctHighAbsenteeism: number;
  } | null;
}

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'GENERATE_REPORT' | 'EXPORT_PDF' | 'LOGIN';

export interface AuditLog {
  id: string;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role'>;
}

// ---------------------------------------------------------------------------
// Phase 9 — simulation, heatmap, comparison
// ---------------------------------------------------------------------------

export interface SimulationEmployeeResult {
  id: string;
  name: string;
  baselineRisk: number;
  simulatedRisk: number;
  delta: number;
}

export interface SimulationResult {
  teamId: string;
  teamName: string;
  employeeCount: number;
  baseline: { riskScore: number; distribution: Record<RiskLevel, number> };
  simulated: { riskScore: number; distribution: Record<RiskLevel, number> };
  deltaRiskScore: number;
  employees: SimulationEmployeeResult[];
  appliedAdjustments: Record<string, number>;
}

export interface HeatmapCell {
  metric: string;
  label: string;
  value: number;
  /** 0 = best across visible teams, 1 = worst. Drives the cell colour. */
  intensity: number;
  worseWhen: 'higher' | 'lower';
}

export interface HeatmapRow {
  teamId: string;
  teamName: string;
  department: string;
  employeeCount: number;
  cells: HeatmapCell[];
}

export interface ComparisonMetric {
  metric: string;
  label: string;
  valueA: number;
  valueB: number;
  difference: number;
  better: 'a' | 'b' | 'tie';
  worseWhen: 'higher' | 'lower';
}

export interface TeamComparison {
  teamA: TeamSummary & { employeeCount: number };
  teamB: TeamSummary & { employeeCount: number };
  metrics: ComparisonMetric[];
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
