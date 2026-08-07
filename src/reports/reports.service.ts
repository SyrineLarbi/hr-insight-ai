import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role, RiskLevel, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import { ReportContext } from '../llm/interfaces/report-context.interface.js';
import {
  AiClientService,
  AiEmployeeInput,
} from './ai-client.service.js';
import { ReportsGateway } from './reports.gateway.js';
import { GenerateReportDto } from './dto/generate-report.dto.js';

type AuthUser = { id: string; email: string; role: string };

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
    private aiClient: AiClientService,
    private gateway: ReportsGateway,
  ) {}

  async generateReport(dto: GenerateReportDto, user: AuthUser) {
    const userId = user.id;
    const totalSteps = 6;

    this.logger.log(
      `Report generation started — team: ${dto.teamId}, user: ${userId}`,
    );

    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });

    if (!team) {
      throw new NotFoundException(`Team ${dto.teamId} not found`);
    }

    if (user.role === Role.TEAM_MANAGER) {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId, teamId: dto.teamId },
      });
      if (!assignment) {
        throw new ForbiddenException('You do not have access to this team');
      }
    }

    const report = await this.prisma.report.create({
      data: {
        teamId: dto.teamId,
        generatedBy: userId,
        dateRangeStart: new Date(dto.dateRangeStart),
        dateRangeEnd: new Date(dto.dateRangeEnd),
        status: 'GENERATING',
      },
    });

    try {
      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 1,
        totalSteps,
        percentage: 10,
        message: 'Fetching team data...',
      });

      const employees = await this.prisma.employee.findMany({
        where: { teamId: dto.teamId },
      });

      if (employees.length === 0) {
        throw new Error('No employees found for this team');
      }

      this.logger.log(
        `Fetched ${employees.length} employees for team ${team.name}`,
      );

      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 2,
        totalSteps,
        percentage: 25,
        message: 'Running AI predictions...',
      });

      const employeeInputs: AiEmployeeInput[] = employees.map((emp) => ({
        salary: emp.salary,
        tenureMonths: emp.tenureMonths,
        engagementScore: emp.engagementScore,
        performanceScore: emp.performanceScore,
        absenteeismDays: emp.absenteeismDays,
        overtimeHours: emp.overtimeHours,
        lastPromotionMonths: emp.lastPromotionMonths,
        trainingHours: emp.trainingHours,
      }));

      const aiResponse = await this.aiClient.predictTeam(employeeInputs);

      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 3,
        totalSteps,
        percentage: 40,
        message: 'Analyzing results...',
      });

      const teamMetrics = this.calculateTeamMetrics(employees);
      const overallRiskScore = Math.round(aiResponse.team_risk_score * 100);

      const predictions = employees.map((emp, idx) => {
        const pred = aiResponse.predictions[idx];
        return {
          employeeName: emp.name,
          riskScore: Math.round(pred.risk_score * 100),
          riskLevel: pred.risk_level,
          topDrivers: pred.risk_drivers.slice(0, 5),
        };
      });

      const reportContext: ReportContext = {
        teamName: team.name,
        department: team.department,
        teamSize: employees.length,
        dateRange: {
          start: dto.dateRangeStart,
          end: dto.dateRangeEnd,
        },
        overallRiskScore,
        riskDistribution: {
          low: aiResponse.risk_distribution.LOW,
          medium: aiResponse.risk_distribution.MEDIUM,
          high: aiResponse.risk_distribution.HIGH,
        },
        predictions,
        teamMetrics,
      };

      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 4,
        totalSteps,
        percentage: 50,
        message: 'Generating executive summary...',
      });

      const summaryText = await this.llmService.generateSummary(reportContext);
      this.logger.log(`Summary generated (${summaryText.length} chars)`);

      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 5,
        totalSteps,
        percentage: 70,
        message: 'Creating action plan...',
      });

      const actionPlanJson =
        await this.llmService.generateActionPlan(reportContext);
      const priorityCount = Array.isArray(actionPlanJson?.priorities)
        ? actionPlanJson.priorities.length
        : 0;
      this.logger.log(`Action plan generated (${priorityCount} priorities)`);

      const projectedRoi = this.extractRoi(actionPlanJson);

      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 6,
        totalSteps,
        percentage: 85,
        message: 'Saving results...',
      });

      const updatedReport = await this.prisma.report.update({
        where: { id: report.id },
        data: {
          summaryText,
          riskScore: overallRiskScore,
          modelVersion: 'v1',
          status: 'COMPLETED',
        },
        include: {
          team: true,
          generatedByUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      const actionPlan = await this.prisma.actionPlan.create({
        data: {
          reportId: report.id,
          planJson: actionPlanJson,
          projectedRoi,
        },
      });

      const riskSnapshots = await Promise.all(
        employees.map((emp, idx) => {
          const pred = aiResponse.predictions[idx];
          return this.prisma.riskSnapshot.create({
            data: {
              employeeId: emp.id,
              riskScore: Math.round(pred.risk_score * 100),
              riskLevel: pred.risk_level as RiskLevel,
              modelVersion: 'v1',
              snapshotDate: new Date(),
            },
          });
        }),
      );

      this.logger.log(
        `Saved: report, action plan, ${riskSnapshots.length} risk snapshots`,
      );

      await this.prisma.auditLog.create({
        data: {
          userId,
          action: AuditAction.GENERATE_REPORT,
          entityType: 'Report',
          entityId: report.id,
          metadata: {
            teamId: dto.teamId,
            teamName: team.name,
            employeeCount: employees.length,
            riskScore: overallRiskScore,
          },
        },
      });

      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 6,
        totalSteps,
        percentage: 100,
        message: 'Report ready!',
      });

      this.gateway.emitComplete(userId, report.id);

      this.logger.log(
        `Report ${report.id} completed — risk: ${overallRiskScore}%, team: ${team.name}`,
      );

      return {
        ...updatedReport,
        actionPlan,
        riskSnapshotCount: riskSnapshots.length,
      };
    } catch (error: any) {
      await this.prisma.report.update({
        where: { id: report.id },
        data: { status: 'FAILED' },
      });

      this.gateway.emitError(userId, report.id, error.message);

      this.logger.error(
        `Report ${report.id} failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAll(user: AuthUser) {
    const where: Record<string, unknown> = {};

    if (user.role === Role.TEAM_MANAGER) {
      const assignments = await this.prisma.teamAssignment.findMany({
        where: { userId: user.id },
        select: { teamId: true },
      });
      where.teamId = { in: assignments.map((a) => a.teamId) };
    } else if (user.role === Role.VIEWER) {
      where.generatedBy = user.id;
    }

    return this.prisma.report.findMany({
      where,
      include: {
        team: true,
        generatedByUser: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        team: { include: { employees: true } },
        generatedByUser: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        actionPlans: true,
      },
    });

    if (!report) {
      throw new NotFoundException(`Report ${id} not found`);
    }

    if (user.role === Role.TEAM_MANAGER) {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId: user.id, teamId: report.teamId },
      });
      if (!assignment) {
        throw new ForbiddenException('You do not have access to this report');
      }
    }

    return report;
  }

  private calculateTeamMetrics(employees: Array<{
    salary: number;
    tenureMonths: number;
    engagementScore: number;
    performanceScore: number;
    absenteeismDays: number;
    overtimeHours: number;
  }>) {
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    return {
      avgSalary: Math.round(avg(employees.map((e) => e.salary))),
      avgTenure: avg(employees.map((e) => e.tenureMonths)),
      avgEngagement: avg(employees.map((e) => e.engagementScore)),
      avgPerformance: avg(employees.map((e) => e.performanceScore)),
      avgAbsenteeism: avg(employees.map((e) => e.absenteeismDays)),
      avgOvertime: avg(employees.map((e) => e.overtimeHours)),
    };
  }

  private extractRoi(plan: Record<string, any>): number | null {
    try {
      const savingsStr: string = plan?.projectedRoi?.projectedSavings || '';
      const match = savingsStr.replace(/,/g, '').match(/\d+/);
      return match ? parseInt(match[0], 10) : null;
    } catch {
      return null;
    }
  }

  async getReportRiskSnapshots(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        team: {
          include: { employees: { select: { id: true } } },
        },
      },
    });

    if (!report) return [];

    const employeeIds = report.team?.employees.map((e) => e.id) || [];

    const snapshots = await this.prisma.riskSnapshot.findMany({
      where: { employeeId: { in: employeeIds } },
      orderBy: { snapshotDate: 'desc' },
    });

    const latestByEmployee = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) {
      if (!latestByEmployee.has(snap.employeeId)) {
        latestByEmployee.set(snap.employeeId, snap);
      }
    }

    return Array.from(latestByEmployee.values());
  }

  async logPdfExport(reportId: string, userId: string) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: AuditAction.EXPORT_PDF,
        entityType: 'Report',
        entityId: reportId,
        metadata: { action: 'PDF export' },
      },
    });
  }
}
