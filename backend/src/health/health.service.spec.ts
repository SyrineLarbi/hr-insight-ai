import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiClientService } from '../reports/ai-client.service.js';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { $queryRaw: jest.Mock };
  let aiClient: { healthCheck: jest.Mock };

  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]) };
    aiClient = {
      healthCheck: jest.fn().mockResolvedValue({
        status: 'ok',
        model_loaded: true,
        model_version: 'v1',
      }),
    };
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-real';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiClientService, useValue: aiClient },
      ],
    }).compile();

    service = module.get(HealthService);
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  describe('live', () => {
    it('reports ok with an uptime', () => {
      const result = service.live();
      expect(result.status).toBe('ok');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('touches no downstream', () => {
      service.live();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(aiClient.healthCheck).not.toHaveBeenCalled();
    });
  });

  describe('ready — everything healthy', () => {
    it('reports up', async () => {
      const result = await service.ready();
      expect(result.status).toBe('up');
    });

    it('probes the database with a real query', async () => {
      await service.ready();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('includes latency for each probed component', async () => {
      const result = await service.ready();
      expect(result.components.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.components.aiService.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('names the loaded model version', async () => {
      const result = await service.ready();
      expect(result.components.aiService.detail).toContain('v1');
    });
  });

  describe('ready — database down', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
    });

    it('reports the overall status as down', async () => {
      // Nothing in the app works without the database, so this is the one
      // component that must fail the readiness probe outright.
      const result = await service.ready();
      expect(result.status).toBe('down');
      expect(result.components.database.status).toBe('down');
    });

    it('does not leak the driver error to the caller', async () => {
      const result = await service.ready();
      expect(result.components.database.detail).not.toContain('ECONNREFUSED');
    });
  });

  describe('ready — AI service degraded or down', () => {
    it('is degraded when the AI service is up but has no model', async () => {
      aiClient.healthCheck.mockResolvedValue({
        status: 'degraded',
        model_loaded: false,
        model_version: 'none',
      });

      const result = await service.ready();
      expect(result.components.aiService.status).toBe('degraded');
      expect(result.status).toBe('degraded');
    });

    it('points at the fix when no model is loaded', async () => {
      aiClient.healthCheck.mockResolvedValue({
        status: 'degraded',
        model_loaded: false,
        model_version: 'none',
      });

      const result = await service.ready();
      expect(result.components.aiService.detail).toContain('/model/retrain');
    });

    it('is down — not degraded — when the AI service is unreachable', async () => {
      aiClient.healthCheck.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.ready();
      expect(result.components.aiService.status).toBe('down');
      expect(result.status).toBe('down');
    });
  });

  describe('ready — LLM key', () => {
    it('is degraded when the key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const result = await service.ready();
      expect(result.components.llm.status).toBe('degraded');
      expect(result.status).toBe('degraded');
    });

    it('treats the .env.example placeholder as missing', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-your-key-here';

      const result = await service.ready();
      expect(result.components.llm.status).toBe('degraded');
    });

    it('explains that reports will use templates', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const result = await service.ready();
      expect(result.components.llm.detail).toContain('fallback templates');
    });

    it('never makes an API call to check the key', async () => {
      // A probe that spends tokens on every poll is a probe nobody can run
      // frequently.
      const result = await service.ready();
      expect(result.components.llm.detail).toContain('configured');
    });
  });

  describe('status aggregation', () => {
    it('down beats degraded', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('nope'));
      delete process.env.ANTHROPIC_API_KEY;

      const result = await service.ready();
      expect(result.status).toBe('down');
    });

    it('probes the database and AI service concurrently', async () => {
      // Serial probes make the endpoint's latency the sum of its dependencies'.
      let resolveDb: () => void;
      const dbGate = new Promise<void>((r) => (resolveDb = r));
      prisma.$queryRaw.mockImplementation(() => dbGate.then(() => [{ '1': 1 }]));

      const pending = service.ready();
      // The AI probe must already have been kicked off while the DB probe waits.
      expect(aiClient.healthCheck).toHaveBeenCalled();
      resolveDb!();
      await pending;
    });
  });
});
