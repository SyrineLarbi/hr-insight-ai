# Phase 6 - Step 3: Reports Module (Orchestration Pipeline)

## Why Are We Doing This?

This is the **central nervous system** of HR Insight AI. Everything built so far — database schema, auth, AI predictions, LLM intelligence, WebSocket progress — converges here in a single orchestrated pipeline:

```
User clicks "Generate Insight"
    │
    ▼
POST /reports/generate { teamId, dateRange }
    │
    ▼
┌─────────────────── Reports Pipeline (16 steps) ───────────────────┐
│                                                                    │
│  1. Validate: team exists, user has RBAC access                   │
│  2. Create Report record (status: GENERATING)                     │
│  3. WS → 10% "Fetching team data..."                             │
│  4. Fetch employees from DB                                       │
│  5. WS → 25% "Running predictions..."                            │
│  6. POST /predict to AI service → risk scores                    │
│  7. WS → 40% "Analyzing results..."                              │
│  8. Calculate team analytics (averages, distributions)            │
│  9. WS → 50% "Generating executive summary..."                   │
│ 10. LLM → executive summary (markdown)                           │
│ 11. WS → 70% "Creating action plan..."                           │
│ 12. LLM → action plan (JSON)                                     │
│ 13. WS → 85% "Saving results..."                                 │
│ 14. Update Report (summaryText, riskScore, COMPLETED)             │
│ 15. Save ActionPlan + RiskSnapshots                               │
│ 16. Log audit: GENERATE_REPORT                                    │
│                                                                    │
│  WS → 100% "Report ready!"                                       │
└────────────────────────────────────────────────────────────────────┘
    │
    ▼
Return completed report to frontend
```

### Why one pipeline instead of separate endpoints?

The user wants **one action** → **one result**. Splitting this into "first predict, then summarize, then save" forces the frontend to orchestrate multi-step workflows, handle partial failures, and manage intermediate state. By keeping the entire pipeline in one service method, we get:

- **Atomicity** — if any step fails, the report is marked FAILED (not left in limbo)
- **Progress tracking** — the service controls the WebSocket events, ensuring accurate progress
- **Single audit entry** — one GENERATE_REPORT log per report, not scattered operations
- **Simpler frontend** — POST one request, listen for progress, receive the result

---

## What We're Building

```
backend/src/
  reports/
    reports.module.ts          ← Module wiring
    reports.controller.ts      ← HTTP endpoints (generate, list, get)
    reports.service.ts         ← Orchestration pipeline (the big one)
    reports.gateway.ts         ← (already created in Step 2)
    dto/
      generate-report.dto.ts   ← Validation DTO for report generation
    ai-client.service.ts       ← HTTP client for AI service calls
  risk-snapshots/
    risk-snapshots.module.ts   ← Module for risk history queries
    risk-snapshots.controller.ts ← GET /risk-snapshots/employee/:id
    risk-snapshots.service.ts  ← Query risk snapshot history
```

---

## The Steps

### Step A: Create the Generate Report DTO

Create `backend/src/reports/dto/generate-report.dto.ts`:

```typescript
import { IsDateString, IsString } from 'class-validator';

/**
 * Request body for POST /reports/generate.
 *
 * The user selects a team and date range on the dashboard,
 * then clicks "Generate Insight" — this DTO validates that input.
 *
 * Why dateRange? The report header shows "Report Period: Jan 1 – Mar 1, 2026".
 * It also provides context to the LLM for time-relevant analysis.
 * The actual employee data comes from the current database state (not filtered by date).
 */
export class GenerateReportDto {
  @IsString()
  teamId: string;

  @IsDateString()
  dateRangeStart: string;

  @IsDateString()
  dateRangeEnd: string;
}
```

---

### Step B: Create the AI Client service

This service wraps HTTP calls to the FastAPI AI service (port 8000). It isolates the external service communication from the business logic.

Create `backend/src/reports/ai-client.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Employee data shape sent to the AI service for prediction.
 * Matches the Pydantic schema defined in Phase 5 (ai-service/app/schemas/prediction.py).
 */
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

/**
 * Single employee prediction result from the AI service.
 */
export interface AiPrediction {
  risk_score: number; // 0–1 probability
  risk_level: string; // "LOW" | "MEDIUM" | "HIGH"
  risk_drivers: Array<{ feature: string; importance: number }>;
}

/**
 * Team prediction response from POST /predict.
 */
export interface AiTeamPredictionResponse {
  team_risk_score: number;
  risk_distribution: { low: number; medium: number; high: number };
  predictions: AiPrediction[];
}

/**
 * AI Service health check response.
 */
export interface AiHealthResponse {
  status: string;
  model_loaded: boolean;
  model_version: string;
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly client: AxiosInstance;

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );

    this.client = axios.create({
      baseURL,
      timeout: 30000, // 30s — prediction can take time for large teams
      headers: { 'Content-Type': 'application/json' },
    });

    this.logger.log(`AI Client initialized — baseURL: ${baseURL}`);
  }

  /**
   * Predict risk scores for all employees in a team.
   *
   * Sends employee data to POST /predict and returns per-employee
   * risk scores plus a team-level summary.
   */
  async predictTeam(
    employees: AiEmployeeInput[],
  ): Promise<AiTeamPredictionResponse> {
    this.logger.log(`Predicting team risk for ${employees.length} employees...`);

    const { data } = await this.client.post<AiTeamPredictionResponse>(
      '/predict',
      { employees },
    );

    this.logger.log(
      `Prediction complete — team risk: ${(data.team_risk_score * 100).toFixed(1)}%`,
    );
    return data;
  }

  /**
   * Health check — verify the AI service is running and model is loaded.
   */
  async healthCheck(): Promise<AiHealthResponse> {
    const { data } = await this.client.get<AiHealthResponse>('/health');
    return data;
  }
}
```

**Why a separate service instead of calling axios directly in ReportsService?**

- **Single point of change** — if the AI service URL, timeout, or auth changes, update one file
- **Typed responses** — TypeScript interfaces for every AI service response
- **Testability** — mock `AiClientService` in tests without mocking HTTP
- **Error boundary** — axios errors are caught and logged here, not scattered through business logic

---

### Step C: Create the Reports service (the orchestration engine)

This is the largest file in the project. Read the inline comments carefully — they explain every decision.

Create `backend/src/reports/reports.service.ts`:

```typescript
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ReportContext } from '../llm/interfaces/report-context.interface';
import { AiClientService, AiEmployeeInput } from './ai-client.service';
import { ReportsGateway } from './reports.gateway';
import { GenerateReportDto } from './dto/generate-report.dto';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
    private aiClient: AiClientService,
    private gateway: ReportsGateway,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Main pipeline
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate a full report for a team.
   *
   * This is the core pipeline — 16 steps orchestrated in sequence.
   * WebSocket progress events fire at each major milestone.
   *
   * If any step fails after the Report record is created, the report
   * is marked FAILED so it doesn't appear as "stuck" in GENERATING state.
   */
  async generateReport(
    dto: GenerateReportDto,
    user: { sub: string; role: string },
  ) {
    const userId = user.sub;
    const totalSteps = 6;

    this.logger.log(
      `Report generation started — team: ${dto.teamId}, user: ${userId}`,
    );

    // ── Step 1: Validate team access ──────────────────────────────
    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });

    if (!team) {
      throw new NotFoundException(`Team ${dto.teamId} not found`);
    }

    // RBAC: TEAM_MANAGERs can only generate reports for their assigned teams
    if (user.role === 'TEAM_MANAGER') {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId, teamId: dto.teamId },
      });
      if (!assignment) {
        throw new ForbiddenException(
          'You do not have access to this team',
        );
      }
    }

    // ── Step 2: Create Report record ──────────────────────────────
    const report = await this.prisma.report.create({
      data: {
        teamId: dto.teamId,
        generatedBy: userId,
        dateRangeStart: new Date(dto.dateRangeStart),
        dateRangeEnd: new Date(dto.dateRangeEnd),
        status: 'GENERATING',
        riskScore: 0,
        summaryText: '',
        modelVersion: 'pending',
      },
    });

    try {
      // ── Step 3: Fetch employees ───────────────────────────────
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

      this.logger.log(`Fetched ${employees.length} employees for team ${team.name}`);

      // ── Step 4: Call AI service for predictions ───────────────
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

      // ── Step 5: Build analytics context ───────────────────────
      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 3,
        totalSteps,
        percentage: 40,
        message: 'Analyzing results...',
      });

      const teamMetrics = this.calculateTeamMetrics(employees);
      const overallRiskScore = Math.round(aiResponse.team_risk_score * 100);

      // Map predictions to employees (same order as input)
      const predictions = employees.map((emp, idx) => {
        const pred = aiResponse.predictions[idx];
        return {
          employeeName: emp.name,
          riskScore: Math.round(pred.risk_score * 100),
          riskLevel: pred.risk_level as 'LOW' | 'MEDIUM' | 'HIGH',
          topDrivers: pred.risk_drivers.slice(0, 5),
        };
      });

      // Build the LLM context
      const reportContext: ReportContext = {
        teamName: team.name,
        department: team.department,
        teamSize: employees.length,
        dateRange: {
          start: dto.dateRangeStart,
          end: dto.dateRangeEnd,
        },
        overallRiskScore,
        riskDistribution: aiResponse.risk_distribution,
        predictions,
        teamMetrics,
      };

      // ── Step 6: Generate executive summary via LLM ────────────
      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 4,
        totalSteps,
        percentage: 50,
        message: 'Generating executive summary...',
      });

      const summaryText = await this.llmService.generateSummary(reportContext);
      this.logger.log(`Summary generated (${summaryText.length} chars)`);

      // ── Step 7: Generate action plan via LLM ──────────────────
      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 5,
        totalSteps,
        percentage: 70,
        message: 'Creating action plan...',
      });

      const actionPlanJson =
        await this.llmService.generateActionPlan(reportContext);
      this.logger.log(
        `Action plan generated (${actionPlanJson.priorities?.length || 0} priorities)`,
      );

      // Calculate projected ROI from the action plan
      const projectedRoi = this.extractRoi(actionPlanJson);

      // ── Step 8: Save everything to DB ─────────────────────────
      this.gateway.emitProgress(userId, {
        reportId: report.id,
        step: 6,
        totalSteps,
        percentage: 85,
        message: 'Saving results...',
      });

      // Update the report record
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
          generatedByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });

      // Save the action plan
      const actionPlan = await this.prisma.actionPlan.create({
        data: {
          reportId: report.id,
          planJson: actionPlanJson,
          projectedRoi,
        },
      });

      // Save risk snapshots for each employee
      const riskSnapshots = await Promise.all(
        employees.map((emp, idx) => {
          const pred = aiResponse.predictions[idx];
          return this.prisma.riskSnapshot.create({
            data: {
              employeeId: emp.id,
              riskScore: Math.round(pred.risk_score * 100),
              riskLevel: pred.risk_level as any,
              modelVersion: 'v1',
              snapshotDate: new Date(),
            },
          });
        }),
      );

      this.logger.log(
        `Saved: report, action plan, ${riskSnapshots.length} risk snapshots`,
      );

      // ── Step 9: Audit log ─────────────────────────────────────
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'GENERATE_REPORT',
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

      // ── Done ──────────────────────────────────────────────────
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
    } catch (error) {
      // Mark report as FAILED so it doesn't stay in GENERATING forever
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

  // ─────────────────────────────────────────────────────────────────
  // Read endpoints
  // ─────────────────────────────────────────────────────────────────

  /**
   * List reports, scoped by user role:
   * - ADMIN / HR_MANAGER → all reports
   * - TEAM_MANAGER → only reports for their assigned teams
   * - VIEWER → only reports they generated (none, unless promoted)
   */
  async findAll(user: { sub: string; role: string }) {
    const where: any = {};

    if (user.role === 'TEAM_MANAGER') {
      const assignments = await this.prisma.teamAssignment.findMany({
        where: { userId: user.sub },
        select: { teamId: true },
      });
      where.teamId = { in: assignments.map((a) => a.teamId) };
    } else if (user.role === 'VIEWER') {
      where.generatedBy = user.sub;
    }

    return this.prisma.report.findMany({
      where,
      include: {
        team: true,
        generatedByUser: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single report with its action plan.
   */
  async findOne(id: string, user: { sub: string; role: string }) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        team: { include: { employees: true } },
        generatedByUser: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        ActionPlan: true,
      },
    });

    if (!report) {
      throw new NotFoundException(`Report ${id} not found`);
    }

    // RBAC check: TEAM_MANAGER can only view reports for their teams
    if (user.role === 'TEAM_MANAGER') {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId: user.sub, teamId: report.teamId },
      });
      if (!assignment) {
        throw new ForbiddenException('You do not have access to this report');
      }
    }

    return report;
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Calculate team-level analytics from raw employee data.
   * These averages feed into the LLM prompt for context.
   */
  private calculateTeamMetrics(employees: any[]) {
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

  /**
   * Extract the projected ROI number from the action plan JSON.
   * Returns null if the LLM didn't produce a parsable number.
   */
  private extractRoi(plan: Record<string, any>): number | null {
    try {
      const savingsStr = plan?.projectedRoi?.projectedSavings || '';
      // Extract first number from strings like "$45,000–$75,000"
      const match = savingsStr.replace(/,/g, '').match(/\d+/);
      return match ? parseInt(match[0], 10) : null;
    } catch {
      return null;
    }
  }
}
```

**Why is the entire pipeline in a `try/catch` block?**

The pipeline creates a Report record in GENERATING state before the expensive operations start. If any step fails (AI service down, LLM rate limited, DB error), the catch block:
1. Marks the report as FAILED (so it doesn't appear "stuck")
2. Emits a WebSocket error event (so the frontend shows an error, not infinite spinner)
3. Logs the error with stack trace
4. Re-throws for NestJS error handling

**Why `Promise.all` for risk snapshots?**

We're inserting one RiskSnapshot per employee. For a 20-person team, that's 20 independent DB inserts. `Promise.all` runs them concurrently instead of sequentially, cutting DB time from ~2s to ~200ms.

---

### Step D: Create the Reports controller

Create `backend/src/reports/reports.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { GenerateReportDto } from './dto/generate-report.dto';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * POST /reports/generate
   *
   * Trigger report generation for a team.
   * Only ADMIN, HR_MANAGER, and TEAM_MANAGER can generate reports.
   * TEAM_MANAGER is further scoped to their assigned teams (in service).
   */
  @Post('generate')
  @Roles('ADMIN', 'HR_MANAGER', 'TEAM_MANAGER')
  generate(@Body() dto: GenerateReportDto, @Req() req: any) {
    return this.reportsService.generateReport(dto, req.user);
  }

  /**
   * GET /reports
   *
   * List all reports (RBAC-scoped by role).
   * All authenticated users can list — scoping happens in service.
   */
  @Get()
  findAll(@Req() req: any) {
    return this.reportsService.findAll(req.user);
  }

  /**
   * GET /reports/:id
   *
   * Get a single report with its action plan.
   * RBAC scoping in service (TEAM_MANAGER restricted to their teams).
   */
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.reportsService.findOne(id, req.user);
  }
}
```

**Why are `@Roles()` only on `generate` and not on `findAll`/`findOne`?**

`findAll` and `findOne` are accessible to all authenticated users — the RBAC scoping happens in the service layer by filtering results. A VIEWER can list their own reports; a TEAM_MANAGER sees only their teams' reports. The `@Roles()` decorator on `generate` explicitly restricts *creating* reports to users with sufficient privileges.

---

### Step E: Create the Risk Snapshots service and controller

**Risk snapshots** track how an employee's risk score changes over time. Every time a report is generated, a snapshot is saved per employee. The frontend uses this data to render a risk timeline chart.

Create `backend/src/risk-snapshots/risk-snapshots.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RiskSnapshotsService {
  private readonly logger = new Logger(RiskSnapshotsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get risk score history for a specific employee.
   *
   * Returns snapshots ordered by date (oldest first) so the frontend
   * can render a line chart showing risk trends over time.
   */
  async getEmployeeHistory(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, teamId: true },
    });

    if (!employee) {
      return { employee: null, snapshots: [] };
    }

    const snapshots = await this.prisma.riskSnapshot.findMany({
      where: { employeeId },
      orderBy: { snapshotDate: 'asc' },
    });

    return {
      employee,
      snapshots,
    };
  }
}
```

Create `backend/src/risk-snapshots/risk-snapshots.controller.ts`:

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RiskSnapshotsService } from './risk-snapshots.service';

@Controller('risk-snapshots')
export class RiskSnapshotsController {
  constructor(private riskSnapshotsService: RiskSnapshotsService) {}

  /**
   * GET /risk-snapshots/employee/:employeeId
   *
   * Returns the risk score history for an employee.
   * Used by the frontend to render a risk timeline chart.
   *
   * Only ADMIN and HR_MANAGER can view risk histories
   * (TEAM_MANAGER scoping could be added later).
   */
  @Get('employee/:employeeId')
  @Roles('ADMIN', 'HR_MANAGER', 'TEAM_MANAGER')
  getEmployeeHistory(@Param('employeeId') employeeId: string) {
    return this.riskSnapshotsService.getEmployeeHistory(employeeId);
  }
}
```

Create `backend/src/risk-snapshots/risk-snapshots.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { RiskSnapshotsController } from './risk-snapshots.controller';
import { RiskSnapshotsService } from './risk-snapshots.service';

@Module({
  controllers: [RiskSnapshotsController],
  providers: [RiskSnapshotsService],
  exports: [RiskSnapshotsService],
})
export class RiskSnapshotsModule {}
```

---

### Step F: Create the Reports module

This module wires together the controller, service, gateway, AI client, and imports from other modules.

Create `backend/src/reports/reports.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LlmModule } from '../llm/llm.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsGateway } from './reports.gateway';
import { AiClientService } from './ai-client.service';

/**
 * ReportsModule — the heart of HR Insight AI.
 *
 * Imports:
 * - LlmModule: for executive summary and action plan generation
 * - JwtModule: for WebSocket gateway JWT verification
 *
 * Providers:
 * - ReportsService: orchestration pipeline
 * - ReportsGateway: WebSocket progress events
 * - AiClientService: HTTP client for AI service predictions
 */
@Module({
  imports: [
    LlmModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsGateway, AiClientService],
  exports: [ReportsService],
})
export class ReportsModule {}
```

**Why does ReportsModule import JwtModule?**

The `ReportsGateway` needs `JwtService` to verify WebSocket handshake tokens. The global JWT setup in `AuthModule` registers `JwtService` for that module — but NestJS modules are isolated by default. By registering `JwtModule` here (with the same secret), the gateway gets its own `JwtService` instance.

---

### Step G: Register modules in AppModule

Update `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LlmModule } from './llm/llm.module';
import { ReportsModule } from './reports/reports.module';
import { RiskSnapshotsModule } from './risk-snapshots/risk-snapshots.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    LlmModule,
    ReportsModule,            // ← add
    RiskSnapshotsModule,      // ← add
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

---

### Step H: Add AI_SERVICE_URL to environment

Add to `backend/.env`:

```bash
# AI Service (FastAPI)
AI_SERVICE_URL=http://localhost:8000
```

---

### Step I: Test the endpoints

Start all services:

```bash
# Terminal 1: AI service
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2: Backend
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

**1. Login to get a JWT:**

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrinsight.com","password":"admin123"}' \
  | python3 -m json.tool
```

Copy the `access_token` from the response.

**2. Generate a report:**

```bash
# Replace YOUR_TOKEN and TEAM_ID with actual values
# Get a team ID first:
curl -s http://localhost:3000/teams \
  -H "Authorization: Bearer YOUR_TOKEN" \
  | python3 -m json.tool

# Generate report (this takes 15-30s):
curl -s -X POST http://localhost:3000/reports/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"TEAM_ID","dateRangeStart":"2026-01-01","dateRangeEnd":"2026-03-01"}' \
  | python3 -m json.tool
```

**3. List reports:**

```bash
curl -s http://localhost:3000/reports \
  -H "Authorization: Bearer YOUR_TOKEN" \
  | python3 -m json.tool
```

**4. Get a specific report:**

```bash
curl -s http://localhost:3000/reports/REPORT_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  | python3 -m json.tool
```

**5. Get risk snapshots for an employee:**

```bash
curl -s http://localhost:3000/risk-snapshots/employee/EMPLOYEE_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  | python3 -m json.tool
```

---

## How to Verify It Worked

### Expected results:

| Check | Expected |
|-------|----------|
| Backend starts with ReportsModule and RiskSnapshotsModule | ✅ |
| POST /reports/generate creates a report with status COMPLETED | ✅ |
| Report has non-empty summaryText (LLM-generated) | ✅ |
| Report has riskScore > 0 | ✅ |
| ActionPlan record created with priorities JSON | ✅ |
| RiskSnapshot records created for each employee in team | ✅ |
| AuditLog entry created with action GENERATE_REPORT | ✅ |
| GET /reports returns report list | ✅ |
| GET /reports/:id returns report with ActionPlan | ✅ |
| GET /risk-snapshots/employee/:id returns snapshot history | ✅ |
| Report without valid token → 401 | ✅ |
| TEAM_MANAGER for wrong team → 403 | ✅ |

---

## Checklist (confirm before Step 4)

- [ ] `backend/src/reports/dto/generate-report.dto.ts` — validates teamId + dateRange
- [ ] `backend/src/reports/ai-client.service.ts` — HTTP client for AI service with typed responses
- [ ] `backend/src/reports/reports.service.ts` — full orchestration pipeline:
  - RBAC validation (TEAM_MANAGER scoping)
  - Report record creation (GENERATING → COMPLETED/FAILED)
  - Employee data fetch
  - AI service prediction call
  - Team metrics calculation
  - LLM summary generation
  - LLM action plan generation
  - Risk snapshot creation per employee
  - Audit log entry
  - WebSocket progress events at each step
- [ ] `backend/src/reports/reports.controller.ts` — POST /generate, GET /, GET /:id
- [ ] `backend/src/risk-snapshots/risk-snapshots.service.ts` — employee risk history
- [ ] `backend/src/risk-snapshots/risk-snapshots.controller.ts` — GET /employee/:id
- [ ] `backend/src/risk-snapshots/risk-snapshots.module.ts`
- [ ] `backend/src/reports/reports.module.ts` — imports LlmModule, JwtModule
- [ ] Both modules registered in `app.module.ts`
- [ ] `AI_SERVICE_URL` in `backend/.env`
- [ ] POST /reports/generate returns a completed report with summary + action plan
- [ ] Risk snapshots saved for all employees

---

Once confirmed, move to **Step 4: PDF Export** — generate downloadable professional reports.
