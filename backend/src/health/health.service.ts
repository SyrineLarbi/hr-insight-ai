import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiClientService } from '../reports/ai-client.service.js';

export type ComponentStatus = 'up' | 'down' | 'degraded';

export interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  detail?: string;
}

export interface HealthResult {
  status: ComponentStatus;
  uptimeSeconds: number;
  timestamp: string;
  components: {
    database: ComponentHealth;
    aiService: ComponentHealth;
    llm: ComponentHealth;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private prisma: PrismaService,
    private aiClient: AiClientService,
  ) {}

  /** Liveness only — is the process accepting requests. */
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * Readiness — probes every downstream the report pipeline needs.
   *
   * Overall status is the worst component status: `down` if the database is
   * unreachable (nothing works without it), `degraded` if only the AI service or
   * LLM key is missing (reports still generate via the fallback templates).
   */
  async ready(): Promise<HealthResult> {
    const [database, aiService] = await Promise.all([
      this.checkDatabase(),
      this.checkAiService(),
    ]);
    const llm = this.checkLlm();

    return {
      status: this.aggregate(database, aiService, llm),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      components: { database, aiService, llm },
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error: any) {
      this.logger.error(`Database health check failed: ${error.message}`);
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        detail: 'Cannot reach the database',
      };
    }
  }

  private async checkAiService(): Promise<ComponentHealth> {
    const started = Date.now();
    try {
      const health = await this.aiClient.healthCheck();
      const latencyMs = Date.now() - started;

      // Reachable but with no model loaded means /predict will 503 — that is
      // degraded, not up.
      if (!health.model_loaded) {
        return {
          status: 'degraded',
          latencyMs,
          detail: 'Reachable but no model loaded — POST /model/retrain',
        };
      }
      return {
        status: 'up',
        latencyMs,
        detail: `model ${health.model_version}`,
      };
    } catch (error: any) {
      this.logger.error(`AI service health check failed: ${error.message}`);
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        detail: 'Cannot reach the AI service',
      };
    }
  }

  private checkLlm(): ComponentHealth {
    // Deliberately not calling the API — a health probe should not spend tokens
    // or count against the rate limit. Presence of the key is what we can check
    // cheaply; a missing key means reports fall back to templates.
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || key.startsWith('sk-ant-your')) {
      return {
        status: 'degraded',
        detail: 'ANTHROPIC_API_KEY not set — reports use fallback templates',
      };
    }
    return { status: 'up', detail: 'API key configured' };
  }

  private aggregate(...components: ComponentHealth[]): ComponentStatus {
    if (components.some((c) => c.status === 'down')) return 'down';
    if (components.some((c) => c.status === 'degraded')) return 'degraded';
    return 'up';
  }
}
