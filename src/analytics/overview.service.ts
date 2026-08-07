import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Metrics the heatmap renders as columns, with the direction that means "bad". */
export const HEATMAP_METRICS = [
  { key: 'riskScore', label: 'Risk Score', worseWhen: 'higher' },
  { key: 'engagementScore', label: 'Engagement', worseWhen: 'lower' },
  { key: 'performanceScore', label: 'Performance', worseWhen: 'lower' },
  { key: 'overtimeHours', label: 'Overtime', worseWhen: 'higher' },
  { key: 'absenteeismDays', label: 'Absenteeism', worseWhen: 'higher' },
  { key: 'lastPromotionMonths', label: 'Months Since Promo', worseWhen: 'higher' },
] as const;

export interface HeatmapCell {
  metric: string;
  label: string;
  value: number;
  /** 0 = best across all teams, 1 = worst. Drives the cell colour. */
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

@Injectable()
export class OverviewService {
  constructor(private prisma: PrismaService) {}

  /**
   * One row per team, one cell per metric, normalised across the teams the user
   * can see.
   *
   * Normalisation is relative rather than absolute: the point of a heatmap is to
   * show which team is worst *here*, and salary bands and overtime norms differ
   * so much between organisations that fixed thresholds would colour everything
   * the same shade.
   */
  async getRiskHeatmap(userId: string, userRole: string): Promise<HeatmapRow[]> {
    const teams = await this.prisma.team.findMany({
      where:
        userRole === 'TEAM_MANAGER'
          ? { teamAssignments: { some: { userId } } }
          : {},
      include: { employees: true },
      orderBy: { name: 'asc' },
    });

    // Teams with no employees have no metrics to average — including them would
    // put a misleading zero-risk row in the grid.
    const populated = teams.filter((t) => t.employees.length > 0);
    if (populated.length === 0) return [];

    const latestRisk = await this.latestRiskByTeam(populated.map((t) => t.id));

    const raw = populated.map((team) => {
      const emps = team.employees;
      const avg = (pick: (e: (typeof emps)[number]) => number) =>
        emps.reduce((sum, e) => sum + pick(e), 0) / emps.length;

      return {
        teamId: team.id,
        teamName: team.name,
        department: team.department,
        employeeCount: emps.length,
        values: {
          // Falls back to 0 when a team has never had a report generated.
          riskScore: latestRisk.get(team.id) ?? 0,
          engagementScore: round(avg((e) => e.engagementScore), 2),
          performanceScore: round(avg((e) => e.performanceScore), 2),
          overtimeHours: round(avg((e) => e.overtimeHours), 1),
          absenteeismDays: round(avg((e) => e.absenteeismDays), 1),
          lastPromotionMonths: round(avg((e) => e.lastPromotionMonths), 1),
        } as Record<string, number>,
      };
    });

    return raw.map((row) => ({
      teamId: row.teamId,
      teamName: row.teamName,
      department: row.department,
      employeeCount: row.employeeCount,
      cells: HEATMAP_METRICS.map((metric) => {
        const all = raw.map((r) => r.values[metric.key]);
        const value = row.values[metric.key];
        return {
          metric: metric.key,
          label: metric.label,
          value,
          intensity: normalise(value, all, metric.worseWhen),
          worseWhen: metric.worseWhen,
        };
      }),
    }));
  }

  /**
   * Side-by-side metrics for exactly two teams, with the gap between them.
   * Both teams are access-checked — comparing against a team you cannot see
   * would otherwise be a way to read its data.
   */
  async compareTeams(
    teamIdA: string,
    teamIdB: string,
    userId: string,
    userRole: string,
  ) {
    if (teamIdA === teamIdB) {
      throw new NotFoundException('Pick two different teams to compare');
    }

    const [a, b] = await Promise.all([
      this.loadTeamForComparison(teamIdA, userId, userRole),
      this.loadTeamForComparison(teamIdB, userId, userRole),
    ]);

    const metrics = HEATMAP_METRICS.map((metric) => {
      const valueA = a.values[metric.key];
      const valueB = b.values[metric.key];
      const difference = round(valueA - valueB, 2);

      // "Better" depends on the metric's direction, so it is resolved here
      // rather than left to the UI to guess from the sign.
      let better: 'a' | 'b' | 'tie' = 'tie';
      if (difference !== 0) {
        const aIsHigher = difference > 0;
        better =
          metric.worseWhen === 'higher'
            ? aIsHigher
              ? 'b'
              : 'a'
            : aIsHigher
              ? 'a'
              : 'b';
      }

      return {
        metric: metric.key,
        label: metric.label,
        valueA,
        valueB,
        difference,
        better,
        worseWhen: metric.worseWhen,
      };
    });

    return {
      teamA: { id: a.teamId, name: a.teamName, department: a.department, employeeCount: a.employeeCount },
      teamB: { id: b.teamId, name: b.teamName, department: b.department, employeeCount: b.employeeCount },
      metrics,
    };
  }

  private async loadTeamForComparison(
    teamId: string,
    userId: string,
    userRole: string,
  ) {
    if (userRole === 'TEAM_MANAGER') {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId, teamId },
      });
      if (!assignment) {
        throw new ForbiddenException(
          'You do not have access to one of these teams',
        );
      }
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { employees: true },
    });

    if (!team) throw new NotFoundException(`Team with id "${teamId}" not found`);
    if (team.employees.length === 0) {
      throw new NotFoundException(`Team "${team.name}" has no employees`);
    }

    const emps = team.employees;
    const avg = (pick: (e: (typeof emps)[number]) => number) =>
      emps.reduce((sum, e) => sum + pick(e), 0) / emps.length;

    const latestRisk = await this.latestRiskByTeam([teamId]);

    return {
      teamId: team.id,
      teamName: team.name,
      department: team.department,
      employeeCount: emps.length,
      values: {
        riskScore: latestRisk.get(teamId) ?? 0,
        engagementScore: round(avg((e) => e.engagementScore), 2),
        performanceScore: round(avg((e) => e.performanceScore), 2),
        overtimeHours: round(avg((e) => e.overtimeHours), 1),
        absenteeismDays: round(avg((e) => e.absenteeismDays), 1),
        lastPromotionMonths: round(avg((e) => e.lastPromotionMonths), 1),
      } as Record<string, number>,
    };
  }

  /** Most recent COMPLETED report risk score per team. */
  private async latestRiskByTeam(teamIds: string[]) {
    const reports = await this.prisma.report.findMany({
      where: { teamId: { in: teamIds }, status: 'COMPLETED' },
      select: { teamId: true, riskScore: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const latest = new Map<string, number>();
    for (const report of reports) {
      if (!latest.has(report.teamId) && report.riskScore !== null) {
        latest.set(report.teamId, report.riskScore);
      }
    }
    return latest;
  }
}

/** Maps a value to 0-1 where 1 is always the worst, whichever way that is. */
function normalise(
  value: number,
  all: number[],
  worseWhen: 'higher' | 'lower',
): number {
  const min = Math.min(...all);
  const max = Math.max(...all);

  // Every team identical — colour them all neutral rather than dividing by zero.
  if (max === min) return 0.5;

  const scaled = (value - min) / (max - min);
  return round(worseWhen === 'higher' ? scaled : 1 - scaled, 3);
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
