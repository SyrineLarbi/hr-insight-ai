import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const SCORE_THRESHOLDS = {
  LOW_MAX: 3.0,
  MEDIUM_MAX: 4.0,
};

const RISK_THRESHOLDS = {
  HIGH_OVERTIME_HOURS: 10,
  LOW_ENGAGEMENT_SCORE: 3.0,
  LOW_PERFORMANCE_SCORE: 3.0,
  LONG_NO_PROMOTION_MONTHS: 24,
  HIGH_ABSENTEEISM_DAYS: 10,
};

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getTeamAnalytics(
    teamId: string,
    userId: string,
    userRole: string,
  ) {
    if (userRole === 'TEAM_MANAGER') {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId, teamId },
      });
      if (!assignment) {
        throw new ForbiddenException('You do not have access to this team');
      }
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        employees: true,
      },
    });

    if (!team) {
      throw new NotFoundException(`Team with id "${teamId}" not found`);
    }

    const employees = team.employees;
    const count = employees.length;

    if (count === 0) {
      return {
        teamId: team.id,
        teamName: team.name,
        department: team.department,
        employeeCount: 0,
        averages: null,
        distributions: null,
        riskIndicators: null,
        message: 'No employees in this team yet',
      };
    }

    const avg = (values: number[]) =>
      values.reduce((sum, v) => sum + v, 0) / values.length;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const averages = {
      salary: r2(avg(employees.map((e) => e.salary))),
      tenureMonths: r2(avg(employees.map((e) => e.tenureMonths))),
      engagementScore: r2(avg(employees.map((e) => e.engagementScore))),
      performanceScore: r2(avg(employees.map((e) => e.performanceScore))),
      absenteeismDays: r2(avg(employees.map((e) => e.absenteeismDays))),
      overtimeHours: r2(avg(employees.map((e) => e.overtimeHours))),
      lastPromotionMonths: r2(avg(employees.map((e) => e.lastPromotionMonths))),
      trainingHours: r2(avg(employees.map((e) => e.trainingHours))),
    };

    const bucket = (score: number): 'low' | 'medium' | 'high' => {
      if (score < SCORE_THRESHOLDS.LOW_MAX) return 'low';
      if (score < SCORE_THRESHOLDS.MEDIUM_MAX) return 'medium';
      return 'high';
    };

    const engagementDist = { low: 0, medium: 0, high: 0 };
    const performanceDist = { low: 0, medium: 0, high: 0 };

    for (const emp of employees) {
      engagementDist[bucket(emp.engagementScore)]++;
      performanceDist[bucket(emp.performanceScore)]++;
    }

    const pct = (n: number) => r2((n / count) * 100);

    const riskIndicators = {
      pctHighOvertime: pct(
        employees.filter(
          (e) => e.overtimeHours > RISK_THRESHOLDS.HIGH_OVERTIME_HOURS,
        ).length,
      ),
      pctLowEngagement: pct(
        employees.filter(
          (e) => e.engagementScore < RISK_THRESHOLDS.LOW_ENGAGEMENT_SCORE,
        ).length,
      ),
      pctLowPerformance: pct(
        employees.filter(
          (e) => e.performanceScore < RISK_THRESHOLDS.LOW_PERFORMANCE_SCORE,
        ).length,
      ),
      pctLongWithoutPromotion: pct(
        employees.filter(
          (e) =>
            e.lastPromotionMonths > RISK_THRESHOLDS.LONG_NO_PROMOTION_MONTHS,
        ).length,
      ),
      pctHighAbsenteeism: pct(
        employees.filter(
          (e) => e.absenteeismDays > RISK_THRESHOLDS.HIGH_ABSENTEEISM_DAYS,
        ).length,
      ),
    };

    return {
      teamId: team.id,
      teamName: team.name,
      department: team.department,
      employeeCount: count,
      averages,
      distributions: {
        engagement: engagementDist,
        performance: performanceDist,
      },
      riskIndicators,
    };
  }
}
