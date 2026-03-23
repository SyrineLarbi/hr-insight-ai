# Phase 6 - Step 1: LLM Module (Groq Integration)

## Why Are We Doing This?

Phases 4–5 built the prediction engine — the AI service takes employee data and returns risk scores. But raw numbers don't drive decisions. A VP of HR doesn't act on `riskScore: 0.73`. They act on:

> "Engineering team's attrition risk has increased 18% quarter-over-quarter, primarily driven by excessive overtime among mid-tenure employees. Three senior engineers are in the critical zone. Immediate action: implement a workload redistribution plan within 2 weeks to prevent $150K in replacement costs."

That's what the LLM does. It transforms structured data (risk scores, feature importances, team metrics) into **executive-ready intelligence**:

1. **Executive Summary** — Professional markdown narrative that a C-suite leader can read in 2 minutes
2. **Structured Action Plan** — JSON with priorities, retention strategies, risk mitigations, and ROI projections that the frontend renders as interactive cards

### Why Groq?

Groq provides free-tier access to Llama 3.3 70B — a model large enough to produce professional HR analysis. Their API is OpenAI-compatible, making it easy to swap providers later. The free tier gives ~14,000 requests/day, more than enough for development and early production.

### Why a separate NestJS module?

Isolating LLM logic in its own module:
- **Single Responsibility** — prompt engineering, retry logic, and response parsing stay in one place
- **Testability** — mock `LlmService` in report tests without hitting the API
- **Swappability** — change from Groq to OpenAI or Anthropic by editing one service
- **Rate Limit Isolation** — retry logic doesn't leak into business logic

---

## What We're Building

```
backend/src/
  llm/
    llm.module.ts              ← NestJS module, exports LlmService
    llm.service.ts             ← Groq SDK, prompts, retry logic, fallbacks
    interfaces/
      report-context.interface.ts  ← TypeScript interface for LLM input
```

---

## The Steps

### Step A: Create the ReportContext interface

This interface defines the data shape that the LLM receives. It's the "contract" between the Reports pipeline (Step 3) and the LLM prompts.

Create `backend/src/llm/interfaces/report-context.interface.ts`:

```typescript
/**
 * The data context passed to LLM prompts for report generation.
 *
 * Built by ReportsService (Step 3) from:
 * - Team + Employee data (Prisma)
 * - AI service predictions (POST /predict)
 * - Calculated analytics (averages, distributions)
 */
export interface ReportContext {
  teamName: string;
  department: string;
  teamSize: number;
  dateRange: { start: string; end: string };

  /** Overall team risk score (0–100 percentage) */
  overallRiskScore: number;

  /** Count of employees per risk level */
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
  };

  /** Per-employee prediction results */
  predictions: Array<{
    employeeName: string;
    riskScore: number; // 0–100
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    topDrivers: Array<{ feature: string; importance: number }>;
  }>;

  /** Aggregated team metrics */
  teamMetrics: {
    avgSalary: number;
    avgTenure: number;
    avgEngagement: number;
    avgPerformance: number;
    avgAbsenteeism: number;
    avgOvertime: number;
  };
}
```

**Why this structure?**

The LLM needs context to generate meaningful insights. Raw risk scores alone produce generic text. By providing team metrics, individual risk drivers, and distributions, the LLM can:
- Compare team metrics to healthy baselines
- Identify patterns across high-risk employees (e.g., "3 of 5 high-risk employees have overtime > 40 hours")
- Calculate ROI based on team size and risk distribution
- Produce specific, actionable recommendations

---

### Step B: Create the LLM service

Create `backend/src/llm/llm.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { ReportContext } from './interfaces/report-context.interface';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly groq: Groq;
  private readonly model: string;
  private readonly maxRetries = 3;

  constructor(private configService: ConfigService) {
    this.groq = new Groq({
      apiKey: this.configService.getOrThrow<string>('GROQ_API_KEY'),
    });
    this.model = this.configService.get<string>(
      'GROQ_MODEL',
      'llama-3.3-70b-versatile',
    );
    this.logger.log(`LLM initialized — model: ${this.model}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate a professional executive summary in markdown format.
   *
   * Returns 3–5 paragraphs suitable for C-suite / HR leadership.
   * Falls back to a template-based summary if the LLM is unavailable.
   */
  async generateSummary(context: ReportContext): Promise<string> {
    const prompt = this.buildSummaryPrompt(context);

    try {
      return await this.callWithRetry(prompt, 2000);
    } catch (error) {
      this.logger.error(`LLM summary generation failed: ${error.message}`);
      return this.fallbackSummary(context);
    }
  }

  /**
   * Generate a structured action plan as a JSON object.
   *
   * Returns priorities, retention strategies, risk mitigations, and ROI.
   * Falls back to a template-based plan if the LLM fails or returns invalid JSON.
   */
  async generateActionPlan(
    context: ReportContext,
  ): Promise<Record<string, any>> {
    const prompt = this.buildActionPlanPrompt(context);

    try {
      const response = await this.callWithRetry(prompt, 3000);
      return this.parseJsonResponse(response, context);
    } catch (error) {
      this.logger.error(`LLM action plan generation failed: ${error.message}`);
      return this.fallbackActionPlan(context);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Retry logic
  // ─────────────────────────────────────────────────────────────────

  /**
   * Call Groq API with exponential backoff retry on 429 (rate limit).
   *
   * Retry delays: 1s → 2s → 4s (2^attempt seconds).
   * Only retries on 429 — all other errors bubble up immediately.
   */
  private async callWithRetry(
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.groq.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert HR analytics consultant specializing in workforce risk assessment, employee retention strategy, and organizational development. You produce professional, data-driven reports for C-suite executives and HR leadership.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.3, // Low temperature for consistent, professional output
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from LLM');
        }
        return content;
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.statusCode === 429;

        if (isRateLimit && attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(
            `Rate limited (429). Retry ${attempt}/${this.maxRetries} in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw new Error('LLM call failed after max retries');
  }

  // ─────────────────────────────────────────────────────────────────
  // Prompt builders
  // ─────────────────────────────────────────────────────────────────

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
    return `Based on the following workforce risk assessment, generate a structured action plan as JSON.

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

Return ONLY valid JSON with this exact structure (no text before or after):
{
  "priorities": [
    {
      "rank": 1,
      "title": "Short action title",
      "description": "What to do and why",
      "impact": "HIGH",
      "timeline": "1-2 weeks",
      "estimatedCost": "$X,XXX",
      "affectedEmployees": 5
    }
  ],
  "retentionStrategies": [
    {
      "strategy": "Strategy name",
      "targetGroup": "Who this targets",
      "expectedImpact": "X% risk reduction",
      "steps": ["Step 1", "Step 2", "Step 3"]
    }
  ],
  "riskMitigations": [
    {
      "risk": "What could go wrong",
      "probability": "HIGH",
      "mitigation": "How to prevent it",
      "owner": "Role responsible"
    }
  ],
  "projectedRoi": {
    "currentRiskCost": "$XXX,XXX",
    "projectedSavings": "$XX,XXX–$XX,XXX",
    "timeframe": "6 months",
    "assumptions": ["Assumption 1", "Assumption 2"]
  }
}

Rules:
- 3–5 priorities, ordered by impact (highest first)
- 2–3 retention strategies targeting identified risk factors
- 2–3 risk mitigations for the most likely scenarios
- ROI based on average replacement cost of $50,000 per employee
- All costs in USD
- Be specific — reference actual team metrics, not generic advice`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Response parsing
  // ─────────────────────────────────────────────────────────────────

  /**
   * Extract and parse JSON from LLM response.
   * Handles both raw JSON and markdown-wrapped JSON (```json ... ```).
   */
  private parseJsonResponse(
    response: string,
    context: ReportContext,
  ): Record<string, any> {
    try {
      // Try direct parse first
      return JSON.parse(response);
    } catch {
      // Try extracting from markdown code block
      const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (jsonMatch?.[1]) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // Fall through to fallback
        }
      }

      this.logger.warn('Failed to parse LLM response as JSON, using fallback');
      return this.fallbackActionPlan(context);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Fallbacks (when LLM is unavailable)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Template-based executive summary used when the LLM API is down.
   * Not as polished as LLM output, but ensures reports always complete.
   */
  private fallbackSummary(ctx: ReportContext): string {
    const riskLabel =
      ctx.overallRiskScore >= 70
        ? 'critical'
        : ctx.overallRiskScore >= 40
          ? 'moderate'
          : 'low';

    return `## Workforce Risk Assessment — ${ctx.teamName}

The **${ctx.teamName}** team (${ctx.department}) presents a **${riskLabel} overall risk level** with a composite score of **${ctx.overallRiskScore}%** across ${ctx.teamSize} employees. Of these, **${ctx.riskDistribution.high} employees are classified as high-risk**, ${ctx.riskDistribution.medium} as medium-risk, and ${ctx.riskDistribution.low} as low-risk.

**Key team metrics** indicate an average engagement score of ${ctx.teamMetrics.avgEngagement.toFixed(1)}/5.0, average performance of ${ctx.teamMetrics.avgPerformance.toFixed(1)}/5.0, and average overtime of ${ctx.teamMetrics.avgOvertime.toFixed(1)} hours/month. ${ctx.teamMetrics.avgOvertime > 20 ? 'Overtime levels are elevated and may be contributing to attrition risk.' : 'Overtime levels are within acceptable ranges.'}

**Immediate attention** is recommended for the ${ctx.riskDistribution.high} high-risk employee(s) to prevent potential turnover costs estimated at $${(ctx.riskDistribution.high * 50000).toLocaleString()}.

*Note: This summary was generated using a template due to temporary LLM unavailability. Regenerate this report for a full AI-powered analysis.*`;
  }

  /**
   * Template-based action plan used when the LLM API is down.
   */
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
          affectedEmployees: ctx.riskDistribution.high + ctx.riskDistribution.medium,
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
          probability:
            ctx.riskDistribution.high > 0 ? 'HIGH' : 'MEDIUM',
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
```

**Why `temperature: 0.3`?**

Temperature controls randomness. For creative writing you want 0.7–1.0 (varied, imaginative). For business reports you want 0.1–0.3 (consistent, factual, professional). We use 0.3 to allow slight variation between reports while keeping the tone corporate and the numbers accurate.

**Why retry only on 429?**

Groq's free tier has rate limits. A 429 means "slow down" — the request is valid but throttled. Retrying with exponential backoff (1s → 2s → 4s) usually succeeds. Other errors (400 = bad request, 500 = server error) won't fix themselves by retrying, so we fail fast and use the fallback instead.

**Why fallbacks instead of failing?**

A report generation involves multiple expensive steps (DB queries, AI service calls, LLM calls). If the LLM is down but predictions are available, it's better to produce a template-based report than to throw away all the work. The fallback summaries are clearly marked so the user knows to regenerate when the LLM is back.

---

### Step C: Create the LLM module

Create `backend/src/llm/llm.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';

@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
```

That's it — one provider, one export. The `ConfigModule` is already global (set up in Phase 1), so `ConfigService` is automatically available for injection in `LlmService`.

---

### Step D: Add the GROQ_API_KEY to environment

Add to `backend/.env`:

```bash
# Groq LLM API
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

**How to get a Groq API key:**
1. Go to https://console.groq.com
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key and copy it

---

### Step E: Register the module

Update `backend/src/app.module.ts` — add `LlmModule` to the imports array:

```typescript
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    LlmModule,       // ← add this
  ],
  // ... rest unchanged
})
export class AppModule {}
```

---

### Step F: Quick smoke test

Start the backend and verify the module loads:

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

Check the console output for:
```
[NestFactory] Starting Nest application...
LLM initialized — model: llama-3.3-70b-versatile
[NestApplication] Nest application successfully started
```

If you see `GROQ_API_KEY` errors, double-check your `.env` file has the key and the backend is loading env variables via ConfigModule.

---

## How to Verify It Worked

Create `backend/test/verify-step6-1.ts`:

```typescript
/**
 * Phase 6 Step 1 Verification: LLM Module
 *
 * Run: npx tsx backend/test/verify-step6-1.ts
 * (from the project root)
 *
 * Requires: GROQ_API_KEY in backend/.env
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LlmService } from '../src/llm/llm.service';
import { ReportContext } from '../src/llm/interfaces/report-context.interface';

async function verify() {
  console.log('=== Phase 6 Step 1: LLM Module Verification ===\n');
  let passed = 0;
  let failed = 0;

  // Boot the NestJS app
  const app = await NestFactory.createApplicationContext(AppModule);
  const llmService = app.get(LlmService);

  // Test context
  const context: ReportContext = {
    teamName: 'Engineering',
    department: 'Technology',
    teamSize: 20,
    dateRange: { start: '2026-01-01', end: '2026-03-01' },
    overallRiskScore: 42,
    riskDistribution: { low: 12, medium: 5, high: 3 },
    predictions: [
      {
        employeeName: 'Alice Johnson',
        riskScore: 78,
        riskLevel: 'HIGH',
        topDrivers: [
          { feature: 'overtimeHours', importance: 0.35 },
          { feature: 'engagementScore', importance: 0.28 },
          { feature: 'lastPromotionMonths', importance: 0.18 },
        ],
      },
      {
        employeeName: 'Bob Smith',
        riskScore: 82,
        riskLevel: 'HIGH',
        topDrivers: [
          { feature: 'engagementScore', importance: 0.32 },
          { feature: 'salary', importance: 0.25 },
          { feature: 'overtimeHours', importance: 0.20 },
        ],
      },
    ],
    teamMetrics: {
      avgSalary: 85000,
      avgTenure: 36.5,
      avgEngagement: 3.2,
      avgPerformance: 3.8,
      avgAbsenteeism: 4.2,
      avgOvertime: 18.5,
    },
  };

  // Test 1: generateSummary
  try {
    console.log('1. Testing generateSummary()...');
    const summary = await llmService.generateSummary(context);
    if (summary && summary.length > 100) {
      console.log(`   ✅ Summary generated (${summary.length} chars)`);
      console.log(`   Preview: ${summary.substring(0, 150)}...`);
      passed++;
    } else {
      console.log(`   ❌ Summary too short or empty (${summary?.length} chars)`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ generateSummary failed: ${error.message}`);
    failed++;
  }

  // Test 2: generateActionPlan
  try {
    console.log('\n2. Testing generateActionPlan()...');
    const plan = await llmService.generateActionPlan(context);
    const hasPriorities = Array.isArray(plan.priorities) && plan.priorities.length > 0;
    const hasStrategies = Array.isArray(plan.retentionStrategies) && plan.retentionStrategies.length > 0;
    const hasRoi = plan.projectedRoi != null;

    if (hasPriorities && hasStrategies && hasRoi) {
      console.log(`   ✅ Action plan generated:`);
      console.log(`      - ${plan.priorities.length} priorities`);
      console.log(`      - ${plan.retentionStrategies.length} retention strategies`);
      console.log(`      - ROI: ${plan.projectedRoi.projectedSavings}`);
      passed++;
    } else {
      console.log(`   ❌ Action plan missing fields: priorities=${hasPriorities}, strategies=${hasStrategies}, roi=${hasRoi}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ generateActionPlan failed: ${error.message}`);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('✅ ALL CHECKS PASSED — LLM Module is ready');
  } else {
    console.log('❌ SOME CHECKS FAILED — review errors above');
  }

  await app.close();
  process.exit(failed > 0 ? 1 : 0);
}

verify().catch((err) => {
  console.error('Verification script error:', err);
  process.exit(1);
});
```

Run it:

```bash
cd /home/syrine/hr-insight-ai
npx tsx backend/test/verify-step6-1.ts
```

### Expected results:

| Check | Expected |
|-------|----------|
| NestJS app boots with LlmModule | ✅ |
| `generateSummary()` returns markdown text > 100 chars | ✅ |
| `generateActionPlan()` returns JSON with priorities, strategies, ROI | ✅ |
| No unhandled errors | ✅ |

---

## Checklist (confirm before Step 2)

- [ ] `backend/src/llm/interfaces/report-context.interface.ts` created with `ReportContext` interface
- [ ] `backend/src/llm/llm.service.ts` created with:
  - `generateSummary()` — executive markdown summary
  - `generateActionPlan()` — structured JSON action plan
  - Retry logic (exponential backoff on 429)
  - Fallback methods (template-based when LLM is unavailable)
  - Professional prompt engineering for both outputs
- [ ] `backend/src/llm/llm.module.ts` created, exports `LlmService`
- [ ] `GROQ_API_KEY` added to `backend/.env`
- [ ] `LlmModule` registered in `app.module.ts`
- [ ] Backend starts without errors
- [ ] Verification script passes both tests (summary + action plan)

---

Once confirmed, move to **Step 2: WebSocket Gateway** — real-time progress events during report generation.
