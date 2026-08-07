import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';

export interface AiEmployeeInput {
  salary: number;
  tenureMonths: number;
  engagementScore: number;
  performanceScore: number;
  absenteeismDays: number;
  overtimeHours: number;
  lastPromotionMonths: number;
  trainingHours: number;
}

export interface AiRiskDriver {
  feature: string;
  importance: number;
  scaled_value?: number;
  direction?: string;
}

export interface AiPrediction {
  employee_index?: number;
  risk_score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  risk_drivers: AiRiskDriver[];
}

export interface AiTeamPredictionResponse {
  team_risk_score: number;
  team_risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  employee_count: number;
  risk_distribution: { LOW: number; MEDIUM: number; HIGH: number };
  high_risk_employees: AiPrediction[];
  predictions: AiPrediction[];
}

export interface AiHealthResponse {
  status: string;
  model_loaded: boolean;
  model_version: string;
  n_features?: number;
  auc_roc?: number;
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly client: AxiosInstance;
  private readonly maxRetries = 3;

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );
    const apiKey = this.configService.get<string>('AI_SERVICE_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'AI_SERVICE_API_KEY is not set — the AI service will reject every ' +
          'request with 401. Set it in backend/.env to match ai-service/.env.',
      );
    }

    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
    });

    this.logger.log(`AI Client initialized — baseURL: ${baseURL}`);
  }

  async predictTeam(
    employees: AiEmployeeInput[],
  ): Promise<AiTeamPredictionResponse> {
    this.logger.log(
      `Predicting team risk for ${employees.length} employees...`,
    );

    const data = await this.withRetry(
      () =>
        this.client
          .post<AiTeamPredictionResponse>('/predict', { employees })
          .then((r) => r.data),
      'predictTeam',
    );

    this.logger.log(
      `Prediction complete — team risk: ${(data.team_risk_score * 100).toFixed(1)}%`,
    );
    return data;
  }

  async healthCheck(): Promise<AiHealthResponse> {
    // No retry here — a health probe should report the current state, not spend
    // seconds trying to make a dead service look alive.
    const { data } = await this.client.get<AiHealthResponse>('/health');
    return data;
  }

  /**
   * Retries transient failures with exponential backoff.
   *
   * Retryable: connection refused/reset, timeouts, and 5xx — including the 503
   * the AI service returns while its model is still loading after a restart.
   * Not retryable: 4xx, which means our request or our API key is wrong and
   * will be just as wrong the second time.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    label: string,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const err = error as AxiosError;
        const status = err.response?.status;

        if (status && status < 500) {
          this.logger.error(
            `${label} failed with ${status} — not retrying: ${this.describe(err)}`,
          );
          throw this.toHttpException(err);
        }

        if (attempt < this.maxRetries) {
          const delay = 500 * 2 ** (attempt - 1); // 500ms, 1s
          this.logger.warn(
            `${label} attempt ${attempt}/${this.maxRetries} failed ` +
              `(${this.describe(err)}). Retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(
      `${label} exhausted ${this.maxRetries} attempts: ${this.describe(lastError as AxiosError)}`,
    );
    throw this.toHttpException(lastError as AxiosError);
  }

  private describe(err: AxiosError): string {
    if (err.response) {
      const detail = (err.response.data as { detail?: string })?.detail;
      return `HTTP ${err.response.status}${detail ? ` — ${detail}` : ''}`;
    }
    return err.code ?? err.message;
  }

  private toHttpException(err: AxiosError): Error {
    const status = err.response?.status;
    const detail = (err.response?.data as { detail?: string })?.detail;

    if (status === 401 || status === 403) {
      return new ServiceUnavailableException(
        'AI service rejected our credentials — check AI_SERVICE_API_KEY',
      );
    }
    if (status === 503) {
      return new ServiceUnavailableException(
        detail ?? 'AI service has no model loaded',
      );
    }
    return new ServiceUnavailableException(
      `AI service unavailable: ${this.describe(err)}`,
    );
  }
}
