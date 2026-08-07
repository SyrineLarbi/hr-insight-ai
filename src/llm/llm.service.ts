import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ReportContext } from './interfaces/report-context.interface.js';

const SYSTEM_PROMPT = `You are an expert HR analytics consultant specializing in workforce risk assessment, employee retention strategy, and organizational development.

You produce professional, data-driven reports for C-suite executives and HR leadership. Your analyses are:
- Specific: reference actual team metrics and named employees when provided, never generic advice
- Quantified: cite numbers, percentages, dollar amounts, and timelines
- Prioritized: highest-impact actions first
- Actionable: every recommendation names an owner, a timeline, and a cost
- Professional: calm, corporate, decision-forward — no hedging or emoji

You write in markdown when asked for prose, and in strict JSON (no markdown fences, no preamble) when the output format demands it.`;

const ACTION_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    priorities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          impact: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          timeline: { type: 'string' },
          estimatedCost: { type: 'string' },
          affectedEmployees: { type: 'integer' },
        },
        required: [
          'rank',
          'title',
          'description',
          'impact',
          'timeline',
          'estimatedCost',
          'affectedEmployees',
        ],
        additionalProperties: false,
      },
    },
    retentionStrategies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          strategy: { type: 'string' },
          targetGroup: { type: 'string' },
          expectedImpact: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['strategy', 'targetGroup', 'expectedImpact', 'steps'],
        additionalProperties: false,
      },
    },
    riskMitigations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          risk: { type: 'string' },
          probability: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          mitigation: { type: 'string' },
          owner: { type: 'string' },
        },
        required: ['risk', 'probability', 'mitigation', 'owner'],
        additionalProperties: false,
      },
    },
    projectedRoi: {
      type: 'object',
      properties: {
        currentRiskCost: { type: 'string' },
        projectedSavings: { type: 'string' },
        timeframe: { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['currentRiskCost', 'projectedSavings', 'timeframe', 'assumptions'],
      additionalProperties: false,
    },
  },
  required: ['priorities', 'retentionStrategies', 'riskMitigations', 'projectedRoi'],
  additionalProperties: false,
};

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly maxRetries = 3;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');

    this.model = this.configService.get<string>(
      'ANTHROPIC_MODEL',
      'claude-opus-5',
    );

    // A missing key used to throw here and take the whole process down on boot,
    // which contradicted the fallback templates further down this file. Now the
    // app starts and reports degrade to templates — /health/ready says so.
    if (!apiKey || apiKey.startsWith('sk-ant-your')) {
      this.client = null;
      this.logger.warn(
        'ANTHROPIC_API_KEY is not set — reports will use fallback templates. ' +
          'Set it in backend/.env for AI-generated summaries.',
      );
      return;
    }

    this.client = new Anthropic({ apiKey });
    this.logger.log(`LLM initialized — model: ${this.model}`);
  }

  /** Whether a real LLM call is possible; false means templates only. */
  isConfigured(): boolean {
    return this.client !== null;
  }

  async generateSummary(context: ReportContext): Promise<string> {
    if (!this.client) return this.fallbackSummary(context);

    const userPrompt = this.buildSummaryPrompt(context);

    try {
      const response = await this.callWithRetry({
        userPrompt,
        maxTokens: 8000,
      });
      return this.extractText(response);
    } catch (error: any) {
      this.logger.error(`LLM summary generation failed: ${error.message}`);
      return this.fallbackSummary(context);
    }
  }

  async generateActionPlan(
    context: ReportContext,
  ): Promise<Record<string, any>> {
    if (!this.client) return this.fallbackActionPlan(context);

    const userPrompt = this.buildActionPlanPrompt(context);

    try {
      const response = await this.callWithRetry({
        userPrompt,
        maxTokens: 16000,
        jsonSchema: ACTION_PLAN_SCHEMA,
      });
      const text = this.extractText(response);
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(
        `LLM action plan generation failed: ${error.message}`,
      );
      return this.fallbackActionPlan(context);
    }
  }

  private async callWithRetry(opts: {
    userPrompt: string;
    maxTokens: number;
    jsonSchema?: Record<string, any>;
  }): Promise<Anthropic.Message> {
    const client = this.client;
    if (!client) throw new Error('LLM client is not configured');

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await client.messages.create({
          model: this.model,
          max_tokens: opts.maxTokens,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          thinking: { type: 'adaptive' },
          ...(opts.jsonSchema && {
            output_config: {
              format: {
                type: 'json_schema',
                schema: opts.jsonSchema,
              },
            },
          }),
          messages: [{ role: 'user', content: opts.userPrompt }],
        } as Anthropic.MessageCreateParamsNonStreaming);

        const usage = response.usage;
        this.logger.debug(
          `LLM call: in=${usage.input_tokens} ` +
            `cached_read=${usage.cache_read_input_tokens ?? 0} ` +
            `cached_write=${usage.cache_creation_input_tokens ?? 0} ` +
            `out=${usage.output_tokens}`,
        );

        return response;
      } catch (error: any) {
        if (
          error instanceof Anthropic.RateLimitError &&
          attempt < this.maxRetries
        ) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(
            `Rate limited (429). Retry ${attempt}/${this.maxRetries} in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        if (
          error instanceof Anthropic.APIError &&
          typeof error.status === 'number' &&
          error.status >= 500 &&
          attempt < this.maxRetries
        ) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(
            `Server error ${error.status}. Retry ${attempt}/${this.maxRetries} in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    throw new Error('LLM call failed after max retries');
  }

  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
  }

  private buildSummaryPrompt(ctx: ReportContext): string {
    const highRisk = ctx.predictions
      .filter((p) => p.riskLevel === 'HIGH')
      .map(
        (p) =>
          `- ${p.employeeName}: ${p.riskScore}% risk (drivers: ${p.topDrivers
            .slice(0, 3)
            .map((d) => d.feature)
            .join(', ')})`,
      )
      .join('\n');

    return `Generate a professional executive summary for a workforce risk assessment report.

TEAM OVERVIEW:
- Team: ${ctx.teamName} (${ctx.department})
- Team Size: ${ctx.teamSize} employees
- Report Period: ${ctx.dateRange.start} to ${ctx.dateRange.end}

RISK ASSESSMENT:
- Overall Team Risk Score: ${ctx.overallRiskScore}%
- Distribution: ${ctx.riskDistribution.high} high-risk, ${ctx.riskDistribution.medium} medium-risk, ${ctx.riskDistribution.low} low-risk

TEAM METRICS:
- Average Salary: $${ctx.teamMetrics.avgSalary.toLocaleString()}
- Average Tenure: ${ctx.teamMetrics.avgTenure.toFixed(1)} months
- Average Engagement Score: ${ctx.teamMetrics.avgEngagement.toFixed(1)}/5.0
- Average Performance Score: ${ctx.teamMetrics.avgPerformance.toFixed(1)}/5.0
- Average Absenteeism: ${ctx.teamMetrics.avgAbsenteeism.toFixed(1)} days/month
- Average Overtime: ${ctx.teamMetrics.avgOvertime.toFixed(1)} hours/month

HIGH-RISK EMPLOYEES:
${highRisk || '(none)'}

INSTRUCTIONS:
Write 3–5 paragraphs that:
1. Open with the overall risk assessment and the single most critical finding
2. Highlight the top risk factors driving attrition in this team
3. Identify patterns across high-risk employees (common traits or conditions)
4. Provide strategic context for decision-makers (cost implications, urgency)
5. Close with a clear, prioritized call to action

Use professional, corporate language suitable for C-suite and HR leadership.
Format in markdown. Bold **key metrics** and **critical findings**.
Do NOT include a title — the report template adds it.`;
  }

  private buildActionPlanPrompt(ctx: ReportContext): string {
    return `Based on the following workforce risk assessment, generate a structured action plan.

TEAM: ${ctx.teamName} (${ctx.department})
TEAM SIZE: ${ctx.teamSize} employees
RISK SCORE: ${ctx.overallRiskScore}%
DISTRIBUTION: ${ctx.riskDistribution.high} high-risk, ${ctx.riskDistribution.medium} medium-risk, ${ctx.riskDistribution.low} low-risk

TEAM METRICS:
- Avg Salary: $${ctx.teamMetrics.avgSalary.toLocaleString()}
- Avg Tenure: ${ctx.teamMetrics.avgTenure.toFixed(1)} months
- Avg Engagement: ${ctx.teamMetrics.avgEngagement.toFixed(1)}/5.0
- Avg Performance: ${ctx.teamMetrics.avgPerformance.toFixed(1)}/5.0
- Avg Absenteeism: ${ctx.teamMetrics.avgAbsenteeism.toFixed(1)} days/month
- Avg Overtime: ${ctx.teamMetrics.avgOvertime.toFixed(1)} hours/month

HIGH-RISK EMPLOYEES: ${ctx.riskDistribution.high}

REQUIREMENTS:
- 3–5 priorities, ranked by impact (highest first, rank: 1 = most urgent)
- 2–3 retention strategies targeting the identified risk factors
- 2–3 risk mitigations for the most likely failure scenarios
- ROI projection based on average replacement cost of $50,000 per employee
- All costs in USD
- Be specific — reference the actual team metrics above, not generic advice`;
  }

  private fallbackSummary(ctx: ReportContext): string {
    const riskLabel =
      ctx.overallRiskScore >= 70
        ? 'critical'
        : ctx.overallRiskScore >= 40
          ? 'moderate'
          : 'low';

    return `The **${ctx.teamName}** team (${ctx.department}) presents a **${riskLabel} overall risk level** with a composite score of **${ctx.overallRiskScore}%** across ${ctx.teamSize} employees. Of these, **${ctx.riskDistribution.high} employees are classified as high-risk**, ${ctx.riskDistribution.medium} as medium-risk, and ${ctx.riskDistribution.low} as low-risk.

**Key team metrics** indicate an average engagement score of ${ctx.teamMetrics.avgEngagement.toFixed(1)}/5.0, average performance of ${ctx.teamMetrics.avgPerformance.toFixed(1)}/5.0, and average overtime of ${ctx.teamMetrics.avgOvertime.toFixed(1)} hours/month. ${ctx.teamMetrics.avgOvertime > 20 ? 'Overtime levels are elevated and may be contributing to attrition risk.' : 'Overtime levels are within acceptable ranges.'}

**Immediate attention** is recommended for the ${ctx.riskDistribution.high} high-risk employee(s) to prevent potential turnover costs estimated at $${(ctx.riskDistribution.high * 50000).toLocaleString()}.

*Note: This summary was generated using a template due to temporary LLM unavailability. Regenerate this report for a full AI-powered analysis.*`;
  }

  private fallbackActionPlan(ctx: ReportContext): Record<string, any> {
    return {
      priorities: [
        {
          rank: 1,
          title: 'Review high-risk employees immediately',
          description: `${ctx.riskDistribution.high} employee(s) are flagged as high attrition risk. Schedule 1-on-1 check-ins within this week.`,
          impact: 'HIGH',
          timeline: '1 week',
          estimatedCost: '$0 (manager time)',
          affectedEmployees: ctx.riskDistribution.high,
        },
        {
          rank: 2,
          title: 'Address top risk drivers',
          description:
            'Analyze the primary risk factors identified in predictions and create targeted intervention plans.',
          impact: 'HIGH',
          timeline: '2–4 weeks',
          estimatedCost: '$5,000–$15,000',
          affectedEmployees:
            ctx.riskDistribution.high + ctx.riskDistribution.medium,
        },
        {
          rank: 3,
          title: 'Team engagement assessment',
          description: `Current average engagement is ${ctx.teamMetrics.avgEngagement.toFixed(1)}/5.0. Conduct a team pulse survey to identify specific dissatisfaction areas.`,
          impact: 'MEDIUM',
          timeline: '2 weeks',
          estimatedCost: '$500–$1,000',
          affectedEmployees: ctx.teamSize,
        },
      ],
      retentionStrategies: [
        {
          strategy: 'Targeted retention conversations',
          targetGroup: 'High-risk employees',
          expectedImpact: '20–30% risk reduction',
          steps: [
            'Identify top 3 risk drivers per employee',
            'Schedule confidential 1-on-1 meetings',
            'Develop individualized retention offers',
          ],
        },
      ],
      riskMitigations: [
        {
          risk: 'Key person departure',
          probability: ctx.riskDistribution.high > 0 ? 'HIGH' : 'MEDIUM',
          mitigation: 'Cross-train critical roles and document key processes',
          owner: 'Team Manager',
        },
      ],
      projectedRoi: {
        currentRiskCost: `$${(ctx.riskDistribution.high * 50000).toLocaleString()}`,
        projectedSavings: `$${(ctx.riskDistribution.high * 15000).toLocaleString()}–$${(ctx.riskDistribution.high * 25000).toLocaleString()}`,
        timeframe: '6 months',
        assumptions: [
          'Average replacement cost: $50,000 per employee',
          'Intervention success rate: 30–50%',
        ],
      },
      _generatedBy: 'fallback-template',
    };
  }
}
