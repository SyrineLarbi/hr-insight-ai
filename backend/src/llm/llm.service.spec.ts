import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service.js';
import { ReportContext } from './interfaces/report-context.interface.js';

/**
 * The fallback paths are what keep report generation working when the Anthropic
 * API is down, rate-limited, or unconfigured. They are also the paths least
 * likely to be exercised by hand, so they are worth pinning down.
 *
 * No test here makes a network call.
 */
describe('LlmService', () => {
  const context: ReportContext = {
    teamName: 'Platform Engineering',
    department: 'Technology',
    teamSize: 20,
    dateRange: { start: '2026-01-01', end: '2026-03-31' },
    overallRiskScore: 72,
    riskDistribution: { low: 8, medium: 7, high: 5 },
    predictions: [
      {
        employeeName: 'Jane Doe',
        riskScore: 88,
        riskLevel: 'HIGH',
        topDrivers: [
          { feature: 'engagementScore', importance: 0.16 },
          { feature: 'overtimeHours', importance: 0.11 },
        ],
      },
    ],
    teamMetrics: {
      avgSalary: 82000,
      avgTenure: 31.4,
      avgEngagement: 2.8,
      avgPerformance: 3.4,
      avgAbsenteeism: 3.2,
      avgOvertime: 24.5,
    },
  };

  async function buildService(config: Record<string, string | undefined>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => config[key] ?? fallback,
          },
        },
      ],
    }).compile();

    return module.get(LlmService);
  }

  describe('when no API key is configured', () => {
    let service: LlmService;

    beforeEach(async () => {
      service = await buildService({});
    });

    it('reports itself as unconfigured instead of throwing on construction', () => {
      // This used to be getOrThrow(), which killed the process at boot.
      expect(service.isConfigured()).toBe(false);
    });

    it('treats the .env.example placeholder as unconfigured', async () => {
      const placeholder = await buildService({
        ANTHROPIC_API_KEY: 'sk-ant-your-key-here',
      });
      expect(placeholder.isConfigured()).toBe(false);
    });

    it('recognises a real-looking key as configured', async () => {
      const configured = await buildService({
        ANTHROPIC_API_KEY: 'sk-ant-api03-abcdef',
      });
      expect(configured.isConfigured()).toBe(true);
    });

    describe('generateSummary falls back to a template', () => {
      it('returns markdown without calling the API', async () => {
        const summary = await service.generateSummary(context);
        expect(summary).toContain('Platform Engineering');
        expect(summary).toContain('Technology');
      });

      it('embeds the real risk score and distribution', async () => {
        const summary = await service.generateSummary(context);
        expect(summary).toContain('72%');
        expect(summary).toContain('5 employees are classified as high-risk');
      });

      it('prices the exposure at $50k per high-risk employee', async () => {
        const summary = await service.generateSummary(context);
        expect(summary).toContain('$250,000'); // 5 x 50,000
      });

      it('flags elevated overtime when the average exceeds 20 hours', async () => {
        const summary = await service.generateSummary(context);
        expect(summary).toContain('Overtime levels are elevated');
      });

      it('does not flag overtime when it is within range', async () => {
        const calm = { ...context, teamMetrics: { ...context.teamMetrics, avgOvertime: 4 } };
        const summary = await service.generateSummary(calm);
        expect(summary).toContain('within acceptable ranges');
      });

      it('labels the report as template-generated so readers are not misled', async () => {
        const summary = await service.generateSummary(context);
        expect(summary.toLowerCase()).toContain('template');
      });

      it.each([
        [85, 'critical'],
        [55, 'moderate'],
        [12, 'low'],
      ])('describes a score of %i as %s risk', async (score, label) => {
        const summary = await service.generateSummary({
          ...context,
          overallRiskScore: score,
        });
        expect(summary).toContain(label);
      });
    });

    describe('generateActionPlan falls back to a template', () => {
      it('matches the shape the PDF and report page expect', async () => {
        const plan = await service.generateActionPlan(context);

        expect(plan).toHaveProperty('priorities');
        expect(plan).toHaveProperty('retentionStrategies');
        expect(plan).toHaveProperty('riskMitigations');
        expect(plan).toHaveProperty('projectedRoi');
      });

      it('marks its provenance so the UI can distinguish it from a real plan', async () => {
        const plan = await service.generateActionPlan(context);
        expect(plan._generatedBy).toBe('fallback-template');
      });

      it('ranks priorities from 1 with no gaps', async () => {
        const plan = await service.generateActionPlan(context);
        const ranks = plan.priorities.map((p: { rank: number }) => p.rank);
        expect(ranks).toEqual([1, 2, 3]);
      });

      it('gives every priority the fields the report table renders', async () => {
        const plan = await service.generateActionPlan(context);

        for (const priority of plan.priorities) {
          expect(priority).toMatchObject({
            rank: expect.any(Number),
            title: expect.any(String),
            description: expect.any(String),
            impact: expect.stringMatching(/^(LOW|MEDIUM|HIGH)$/),
            timeline: expect.any(String),
            estimatedCost: expect.any(String),
            affectedEmployees: expect.any(Number),
          });
        }
      });

      it('carries the high-risk headcount into the first priority', async () => {
        const plan = await service.generateActionPlan(context);
        expect(plan.priorities[0].affectedEmployees).toBe(5);
      });

      it('raises mitigation probability to HIGH when anyone is high-risk', async () => {
        const plan = await service.generateActionPlan(context);
        expect(plan.riskMitigations[0].probability).toBe('HIGH');
      });

      it('drops mitigation probability to MEDIUM when nobody is high-risk', async () => {
        const plan = await service.generateActionPlan({
          ...context,
          riskDistribution: { low: 18, medium: 2, high: 0 },
        });
        expect(plan.riskMitigations[0].probability).toBe('MEDIUM');
      });

      it('states its ROI assumptions rather than presenting bare numbers', async () => {
        const plan = await service.generateActionPlan(context);
        expect(plan.projectedRoi.assumptions.length).toBeGreaterThan(0);
        expect(plan.projectedRoi.currentRiskCost).toContain('$250,000');
      });

      it('produces JSON-serialisable output for the ActionPlan.planJson column', async () => {
        const plan = await service.generateActionPlan(context);
        expect(() => JSON.stringify(plan)).not.toThrow();
      });
    });

    it('survives a team with no employees and no risk', async () => {
      const empty: ReportContext = {
        ...context,
        teamSize: 0,
        overallRiskScore: 0,
        riskDistribution: { low: 0, medium: 0, high: 0 },
        predictions: [],
      };

      await expect(service.generateSummary(empty)).resolves.toBeTruthy();
      await expect(service.generateActionPlan(empty)).resolves.toHaveProperty(
        'priorities',
      );
    });
  });

  describe('model selection', () => {
    it('uses ANTHROPIC_MODEL when set', async () => {
      const service = await buildService({
        ANTHROPIC_API_KEY: 'sk-ant-api03-abc',
        ANTHROPIC_MODEL: 'claude-sonnet-5',
      });
      expect(service['model']).toBe('claude-sonnet-5');
    });

    it('falls back to a default model when unset', async () => {
      const service = await buildService({ ANTHROPIC_API_KEY: 'sk-ant-api03-abc' });
      expect(service['model']).toBeTruthy();
    });
  });
});
