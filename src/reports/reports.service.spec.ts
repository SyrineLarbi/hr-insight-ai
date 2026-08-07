import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import { AiClientService } from './ai-client.service.js';
import { ReportsGateway } from './reports.gateway.js';

/**
 * The report pipeline touches every part of the system: RBAC, the ML service,
 * the LLM, four tables, and the WebSocket. Everything external is mocked, so
 * these tests are about orchestration — does it check access before creating
 * rows, does it mark the report FAILED when a downstream dies, does the
 * WebSocket client get told.
 */
describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;
  let llm: { generateSummary: jest.Mock; generateActionPlan: jest.Mock };
  let aiClient: { predictTeam: jest.Mock };
  let gateway: {
    emitProgress: jest.Mock;
    emitComplete: jest.Mock;
    emitError: jest.Mock;
  };

  const TEAM_ID = '11111111-1111-1111-1111-111111111111';
  const REPORT_ID = 'report-1';
  const ADMIN = { id: 'admin-1', email: 'a@x.com', role: 'ADMIN' };
  const MANAGER = { id: 'mgr-1', email: 'm@x.com', role: 'TEAM_MANAGER' };
  const VIEWER = { id: 'view-1', email: 'v@x.com', role: 'VIEWER' };

  const dto = {
    teamId: TEAM_ID,
    dateRangeStart: '2026-01-01',
    dateRangeEnd: '2026-03-31',
  } as never;

  const employee = (i: number) => ({
    id: `emp-${i}`,
    name: `Employee ${i}`,
    teamId: TEAM_ID,
    salary: 60000 + i * 1000,
    tenureMonths: 24,
    engagementScore: 3,
    performanceScore: 3.5,
    absenteeismDays: 2,
    overtimeHours: 8,
    lastPromotionMonths: 12,
    trainingHours: 20,
  });

  const prediction = (score: number) => ({
    risk_score: score,
    risk_level: score >= 0.6 ? 'HIGH' : score >= 0.3 ? 'MEDIUM' : 'LOW',
    risk_drivers: [{ feature: 'engagementScore', importance: 0.16 }],
  });

  beforeEach(async () => {
    prisma = {
      team: { findUnique: jest.fn().mockResolvedValue({ id: TEAM_ID, name: 'Platform', department: 'Tech' }) },
      teamAssignment: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      employee: { findMany: jest.fn().mockResolvedValue([employee(1), employee(2)]) },
      report: {
        create: jest.fn().mockResolvedValue({ id: REPORT_ID }),
        update: jest.fn().mockResolvedValue({ id: REPORT_ID, status: 'COMPLETED' }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      actionPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
      riskSnapshot: {
        create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    llm = {
      generateSummary: jest.fn().mockResolvedValue('## Summary'),
      generateActionPlan: jest.fn().mockResolvedValue({
        priorities: [{ rank: 1 }],
        projectedRoi: { projectedSavings: '$75,000–$120,000' },
      }),
    };

    aiClient = {
      predictTeam: jest.fn().mockResolvedValue({
        team_risk_score: 0.62,
        team_risk_level: 'HIGH',
        employee_count: 2,
        risk_distribution: { LOW: 0, MEDIUM: 1, HIGH: 1 },
        high_risk_employees: [prediction(0.8)],
        predictions: [prediction(0.8), prediction(0.44)],
      }),
    };

    gateway = {
      emitProgress: jest.fn(),
      emitComplete: jest.fn(),
      emitError: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LlmService, useValue: llm },
        { provide: AiClientService, useValue: aiClient },
        { provide: ReportsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  describe('generateReport — access control', () => {
    it('throws 404 for a team that does not exist', async () => {
      prisma.team.findUnique.mockResolvedValue(null);

      await expect(service.generateReport(dto, ADMIN)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('blocks a TEAM_MANAGER generating for an unassigned team', async () => {
      prisma.teamAssignment.findFirst.mockResolvedValue(null);

      await expect(service.generateReport(dto, MANAGER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not create a report row when access is denied', async () => {
      // A GENERATING row left behind by a rejected request would show up in the
      // reports list as a permanently stuck report.
      prisma.teamAssignment.findFirst.mockResolvedValue(null);

      await expect(service.generateReport(dto, MANAGER)).rejects.toThrow();
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('allows a TEAM_MANAGER generating for an assigned team', async () => {
      prisma.teamAssignment.findFirst.mockResolvedValue({ id: 'assign-1' });

      await expect(service.generateReport(dto, MANAGER)).resolves.toBeDefined();
    });

    it('does not check assignments for ADMIN', async () => {
      await service.generateReport(dto, ADMIN);
      expect(prisma.teamAssignment.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('generateReport — happy path', () => {
    it('completes and returns the saved report', async () => {
      const result = await service.generateReport(dto, ADMIN);
      expect(result.id).toBe(REPORT_ID);
    });

    it('passes every employee to the ML service', async () => {
      await service.generateReport(dto, ADMIN);

      const sent = aiClient.predictTeam.mock.calls[0][0];
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual({
        salary: 61000,
        tenureMonths: 24,
        engagementScore: 3,
        performanceScore: 3.5,
        absenteeismDays: 2,
        overtimeHours: 8,
        lastPromotionMonths: 12,
        trainingHours: 20,
      });
    });

    it('does not leak employee names or ids to the ML service', async () => {
      await service.generateReport(dto, ADMIN);

      const sent = aiClient.predictTeam.mock.calls[0][0];
      expect(sent[0]).not.toHaveProperty('name');
      expect(sent[0]).not.toHaveProperty('id');
    });

    it('converts the 0-1 model score to a 0-100 report score', async () => {
      await service.generateReport(dto, ADMIN);

      const update = prisma.report.update.mock.calls[0][0];
      expect(update.data.riskScore).toBe(62); // 0.62 -> 62
      expect(update.data.status).toBe('COMPLETED');
    });

    it('gives the LLM the real team metrics, averaged', async () => {
      await service.generateReport(dto, ADMIN);

      const context = llm.generateSummary.mock.calls[0][0];
      expect(context.teamSize).toBe(2);
      expect(context.avgSalary ?? context.teamMetrics.avgSalary).toBe(61500);
      expect(context.teamMetrics.avgEngagement).toBe(3);
    });

    it('names employees in the LLM context so the summary can cite them', async () => {
      await service.generateReport(dto, ADMIN);

      const context = llm.generateSummary.mock.calls[0][0];
      expect(context.predictions[0].employeeName).toBe('Employee 1');
      expect(context.predictions[0].riskScore).toBe(80);
    });

    it('writes one risk snapshot per employee', async () => {
      await service.generateReport(dto, ADMIN);
      expect(prisma.riskSnapshot.create).toHaveBeenCalledTimes(2);
    });

    it('stores snapshot scores on the 0-100 scale', async () => {
      await service.generateReport(dto, ADMIN);

      const first = prisma.riskSnapshot.create.mock.calls[0][0].data;
      expect(first.riskScore).toBe(80);
      expect(first.riskLevel).toBe('HIGH');
    });

    it('persists the action plan alongside the report', async () => {
      await service.generateReport(dto, ADMIN);

      const plan = prisma.actionPlan.create.mock.calls[0][0].data;
      expect(plan.reportId).toBe(REPORT_ID);
      expect(plan.planJson).toHaveProperty('priorities');
    });

    it('audit-logs the generation with the team and score', async () => {
      await service.generateReport(dto, ADMIN);

      const log = prisma.auditLog.create.mock.calls[0][0].data;
      expect(log.action).toBe('GENERATE_REPORT');
      expect(log.entityId).toBe(REPORT_ID);
      expect(log.metadata.riskScore).toBe(62);
    });
  });

  describe('generateReport — WebSocket progress', () => {
    it('emits all six steps then completion', async () => {
      await service.generateReport(dto, ADMIN);

      const percentages = gateway.emitProgress.mock.calls.map((c) => c[1].percentage);
      expect(percentages).toEqual([10, 25, 40, 50, 70, 85, 100]);
      expect(gateway.emitComplete).toHaveBeenCalledWith(ADMIN.id, REPORT_ID);
    });

    it('emits progress monotonically', async () => {
      await service.generateReport(dto, ADMIN);

      const percentages = gateway.emitProgress.mock.calls.map((c) => c[1].percentage);
      expect(percentages).toEqual([...percentages].sort((a, b) => a - b));
    });

    it('addresses progress to the requesting user only', async () => {
      await service.generateReport(dto, ADMIN);

      for (const call of gateway.emitProgress.mock.calls) {
        expect(call[0]).toBe(ADMIN.id);
      }
    });
  });

  describe('generateReport — failure handling', () => {
    it('rejects a team with no employees', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      await expect(service.generateReport(dto, ADMIN)).rejects.toThrow(
        'No employees found',
      );
    });

    it('marks the report FAILED when the ML service is down', async () => {
      aiClient.predictTeam.mockRejectedValue(new Error('AI service unavailable'));

      await expect(service.generateReport(dto, ADMIN)).rejects.toThrow();

      const failing = prisma.report.update.mock.calls.find(
        (c: any[]) => c[0].data.status === 'FAILED',
      );
      expect(failing).toBeDefined();
    });

    it('tells the WebSocket client why it failed', async () => {
      aiClient.predictTeam.mockRejectedValue(new Error('AI service unavailable'));

      await expect(service.generateReport(dto, ADMIN)).rejects.toThrow();
      expect(gateway.emitError).toHaveBeenCalledWith(
        ADMIN.id,
        REPORT_ID,
        'AI service unavailable',
      );
    });

    it('does not emit completion on failure', async () => {
      aiClient.predictTeam.mockRejectedValue(new Error('boom'));

      await expect(service.generateReport(dto, ADMIN)).rejects.toThrow();
      expect(gateway.emitComplete).not.toHaveBeenCalled();
    });

    it('does not write snapshots when prediction fails', async () => {
      aiClient.predictTeam.mockRejectedValue(new Error('boom'));

      await expect(service.generateReport(dto, ADMIN)).rejects.toThrow();
      expect(prisma.riskSnapshot.create).not.toHaveBeenCalled();
    });

    it('still completes when the LLM falls back to templates', async () => {
      // generateSummary/generateActionPlan never throw — they degrade. A report
      // must still reach COMPLETED in that case.
      llm.generateActionPlan.mockResolvedValue({
        priorities: [],
        projectedRoi: {},
        _generatedBy: 'fallback-template',
      });

      const result = await service.generateReport(dto, ADMIN);
      expect(result).toBeDefined();
      expect(gateway.emitComplete).toHaveBeenCalled();
    });
  });

  describe('extractRoi', () => {
    const roi = (plan: unknown) => (service as any).extractRoi(plan);

    it('parses the first dollar figure out of a range', () => {
      expect(roi({ projectedRoi: { projectedSavings: '$75,000–$120,000' } })).toBe(75000);
    });

    it('handles a single figure', () => {
      expect(roi({ projectedRoi: { projectedSavings: '$50,000' } })).toBe(50000);
    });

    it('returns null when there is no ROI block', () => {
      expect(roi({})).toBeNull();
    });

    it('returns null for prose with no number', () => {
      expect(roi({ projectedRoi: { projectedSavings: 'to be determined' } })).toBeNull();
    });

    it('does not throw on a null plan', () => {
      expect(roi(null)).toBeNull();
    });
  });

  describe('calculateTeamMetrics', () => {
    const metrics = (emps: unknown[]) => (service as any).calculateTeamMetrics(emps);

    it('averages each metric', () => {
      const result = metrics([employee(1), employee(3)]);
      expect(result.avgSalary).toBe(62000); // 61000 and 63000
      expect(result.avgEngagement).toBe(3);
    });

    it('rounds salary to whole dollars', () => {
      const result = metrics([
        { ...employee(1), salary: 100 },
        { ...employee(2), salary: 101 },
      ]);
      expect(Number.isInteger(result.avgSalary)).toBe(true);
    });

    it('returns zeros for an empty team instead of NaN', () => {
      // NaN would serialise to null in JSON and break the PDF renderer.
      const result = metrics([]);
      expect(result.avgSalary).toBe(0);
      expect(result.avgEngagement).toBe(0);
      expect(Number.isNaN(result.avgTenure)).toBe(false);
    });
  });

  describe('findAll — list scoping', () => {
    it('scopes a TEAM_MANAGER to their assigned teams', async () => {
      prisma.teamAssignment.findMany.mockResolvedValue([{ teamId: TEAM_ID }]);

      await service.findAll(MANAGER);

      expect(prisma.report.findMany.mock.calls[0][0].where.teamId).toEqual({
        in: [TEAM_ID],
      });
    });

    it('scopes a VIEWER to reports they generated themselves', async () => {
      await service.findAll(VIEWER);

      expect(prisma.report.findMany.mock.calls[0][0].where.generatedBy).toBe(
        VIEWER.id,
      );
    });

    it('does not scope ADMIN', async () => {
      await service.findAll(ADMIN);

      const where = prisma.report.findMany.mock.calls[0][0].where;
      expect(where.teamId).toBeUndefined();
      expect(where.generatedBy).toBeUndefined();
    });

    it('yields an empty scope for a TEAM_MANAGER with no assignments', async () => {
      prisma.teamAssignment.findMany.mockResolvedValue([]);

      await service.findAll(MANAGER);

      expect(prisma.report.findMany.mock.calls[0][0].where.teamId).toEqual({
        in: [],
      });
    });
  });

  describe('findOne — detail scoping', () => {
    it('throws 404 for an unknown report', async () => {
      prisma.report.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing', ADMIN)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks a TEAM_MANAGER reading a report for an unassigned team', async () => {
      prisma.report.findUnique.mockResolvedValue({ id: REPORT_ID, teamId: 'other' });
      prisma.teamAssignment.findFirst.mockResolvedValue(null);

      await expect(service.findOne(REPORT_ID, MANAGER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows a TEAM_MANAGER reading a report for an assigned team', async () => {
      prisma.report.findUnique.mockResolvedValue({ id: REPORT_ID, teamId: TEAM_ID });
      prisma.teamAssignment.findFirst.mockResolvedValue({ id: 'assign-1' });

      await expect(service.findOne(REPORT_ID, MANAGER)).resolves.toBeDefined();
    });
  });

  describe('getReportRiskSnapshots', () => {
    it('returns only the newest snapshot per employee', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: REPORT_ID,
        team: { employees: [{ id: 'emp-1' }, { id: 'emp-2' }] },
      });
      // findMany is ordered snapshotDate desc, so the first per employee wins.
      prisma.riskSnapshot.findMany.mockResolvedValue([
        { id: 's3', employeeId: 'emp-1', riskScore: 80 },
        { id: 's2', employeeId: 'emp-1', riskScore: 60 },
        { id: 's1', employeeId: 'emp-2', riskScore: 30 },
      ]);

      const result = await service.getReportRiskSnapshots(REPORT_ID);

      expect(result).toHaveLength(2);
      expect(result.map((s: any) => s.id)).toEqual(['s3', 's1']);
    });

    it('returns an empty array for an unknown report', async () => {
      prisma.report.findUnique.mockResolvedValue(null);
      await expect(service.getReportRiskSnapshots('missing')).resolves.toEqual([]);
    });
  });
});
