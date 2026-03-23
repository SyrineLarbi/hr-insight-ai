# Phase 3 - Step 3: AnalyticsModule — Team Metrics Aggregation

## Why Are We Doing This?

The analytics endpoint is the **bridge between raw employee data and the AI pipeline**.

When Phase 5 (ML Model) and Phase 6 (Reports) are built, the report generation pipeline will call `GET /analytics/team/:teamId` to get pre-aggregated team statistics before sending data to the ML model. The analytics also power the frontend dashboard — the charts that show at a glance whether a team is healthy or at risk.

Without analytics, an HR Manager looking at a team of 20 employees has to mentally process 20 rows of numbers. With analytics, they see:
- Average engagement: **2.3/5** (dangerously low)
- 65% of employees haven't been promoted in over 2 years
- 40% work more than 10 hours of overtime weekly

These are the numbers that trigger action. They're also the numbers the LLM will use in Phase 6 to write the executive summary.

---

## How Analytics Are Computed

Unlike reports (which require the ML model), analytics are **pure database aggregation** — computed in-memory from the employee rows we already have:

```
GET /analytics/team/:teamId
        │
        ▼
  Fetch all employees in team (one Prisma query)
        │
        ▼
  Compute in JavaScript:
  - Averages (salary, tenure, engagement, performance, etc.)
  - Distributions (how many employees are low/medium/high engagement)
  - Risk indicators (% overtime, % disengaged, % overdue for promotion)
        │
        ▼
  Return structured JSON — no ML needed
```

We deliberately do NOT use Prisma's `aggregate()` or `groupBy()` for this. Why? Because we need to run multiple computations over the same dataset (averages, buckets, risk indicators). Fetching employees once and computing everything in memory is faster than 3-4 separate aggregate queries.

---

## What We're Building

```
backend/src/analytics/
  analytics.service.ts      ← fetches employees, computes all metrics in-memory
  analytics.controller.ts   ← GET /analytics/team/:teamId
  analytics.module.ts       ← module definition

backend/src/app.module.ts   ← MODIFIED: imports AnalyticsModule
backend/test-requests/
  analytics.http            ← REST Client test file for this step
```

No DTOs needed — this module only has GET endpoints with a UUID path param.

---

## The Analytics Response Structure

Understanding the output before writing the code:

```json
{
  "teamId": "uuid",
  "teamName": "Platform Engineering",
  "department": "Engineering",
  "employeeCount": 20,

  "averages": {
    "salary": 87450.50,
    "tenureMonths": 28.4,
    "engagementScore": 2.95,
    "performanceScore": 3.20,
    "absenteeismDays": 7.3,
    "overtimeHours": 9.1,
    "lastPromotionMonths": 19.6,
    "trainingHours": 34.2
  },

  "distributions": {
    "engagement": {
      "low":    8,   ← engagementScore 1.0–2.9
      "medium": 7,   ← engagementScore 3.0–3.9
      "high":   5    ← engagementScore 4.0–5.0
    },
    "performance": {
      "low":    4,
      "medium": 10,
      "high":   6
    }
  },

  "riskIndicators": {
    "pctHighOvertime":           45.0,  ← % employees with overtime > 10h/week
    "pctLowEngagement":          40.0,  ← % employees with engagement < 3.0
    "pctLowPerformance":         20.0,  ← % employees with performance < 3.0
    "pctLongWithoutPromotion":   55.0,  ← % employees without promotion for > 24 months
    "pctHighAbsenteeism":        35.0   ← % employees with absenteeism > 10 days/year
  }
}
```

The `riskIndicators` are the most important part — these are the early warning signals. An HR Manager doesn't need to read 20 rows; they see "55% haven't been promoted in 2 years" and know what to address.

---

## The Steps

### Step A: Create the folder structure

```bash
mkdir -p /home/syrine/hr-insight-ai/backend/src/analytics
```

---

### Step B: Create the AnalyticsService

Create `backend/src/analytics/analytics.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// ─────────────────────────────────────────────────────────────────────
// Bucket thresholds for engagement and performance scores (1–5 scale)
// ─────────────────────────────────────────────────────────────────────
const SCORE_THRESHOLDS = {
  LOW_MAX: 3.0,    // score < 3.0 → low
  MEDIUM_MAX: 4.0, // 3.0 ≤ score < 4.0 → medium
  // score ≥ 4.0 → high
};

// ─────────────────────────────────────────────────────────────────────
// Risk thresholds — tuned to typical HR benchmarks
// ─────────────────────────────────────────────────────────────────────
const RISK_THRESHOLDS = {
  HIGH_OVERTIME_HOURS: 10,       // > 10h/week overtime
  LOW_ENGAGEMENT_SCORE: 3.0,     // < 3.0 engagement
  LOW_PERFORMANCE_SCORE: 3.0,    // < 3.0 performance
  LONG_NO_PROMOTION_MONTHS: 24,  // > 24 months without promotion
  HIGH_ABSENTEEISM_DAYS: 10,     // > 10 days absent/year
};

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  // ============================
  // GET TEAM ANALYTICS
  // Fetches employees and computes all metrics in-memory
  // ============================
  async getTeamAnalytics(
    teamId: string,
    userId: string,
    userRole: string,
  ) {
    // TEAM_MANAGER scoping: must be assigned to this team
    if (userRole === 'TEAM_MANAGER') {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId, teamId },
      });
      if (!assignment) {
        throw new ForbiddenException('You do not have access to this team');
      }
    }

    // Fetch team + all employees in one query
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

    // Handle empty team gracefully
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

    // ── Compute averages ───────────────────────────────────────────────
    const avg  = (values: number[]) =>
      values.reduce((sum, v) => sum + v, 0) / values.length;
    const r2   = (n: number) => Math.round(n * 100) / 100; // round to 2 decimals

    const averages = {
      salary:               r2(avg(employees.map((e) => e.salary))),
      tenureMonths:         r2(avg(employees.map((e) => e.tenureMonths))),
      engagementScore:      r2(avg(employees.map((e) => e.engagementScore))),
      performanceScore:     r2(avg(employees.map((e) => e.performanceScore))),
      absenteeismDays:      r2(avg(employees.map((e) => e.absenteeismDays))),
      overtimeHours:        r2(avg(employees.map((e) => e.overtimeHours))),
      lastPromotionMonths:  r2(avg(employees.map((e) => e.lastPromotionMonths))),
      trainingHours:        r2(avg(employees.map((e) => e.trainingHours))),
    };

    // ── Compute distributions ──────────────────────────────────────────
    const bucket = (score: number): 'low' | 'medium' | 'high' => {
      if (score < SCORE_THRESHOLDS.LOW_MAX)    return 'low';
      if (score < SCORE_THRESHOLDS.MEDIUM_MAX) return 'medium';
      return 'high';
    };

    const engagementDist  = { low: 0, medium: 0, high: 0 };
    const performanceDist = { low: 0, medium: 0, high: 0 };

    for (const emp of employees) {
      engagementDist[bucket(emp.engagementScore)]++;
      performanceDist[bucket(emp.performanceScore)]++;
    }

    // ── Compute risk indicators ────────────────────────────────────────
    // Each is a percentage (0–100) of the team with that risk flag
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
```

**Why constants at the top for thresholds?**

If a data scientist decides "high overtime should be 8 hours, not 10", they change one constant — not 5 scattered comparison values. Constants also serve as documentation: they tell the next developer exactly what business rules were applied.

**Why `for...of` loop instead of multiple `.filter()` calls for distributions?**

```typescript
// ❌ Less efficient — 2 loops over 60 employees:
const low    = employees.filter(e => bucket(e.engagementScore) === 'low').length;
const medium = employees.filter(e => bucket(e.engagementScore) === 'medium').length;
const high   = employees.filter(e => bucket(e.engagementScore) === 'high').length;

// ✅ More efficient — 1 loop, both distributions at once:
for (const emp of employees) {
  engagementDist[bucket(emp.engagementScore)]++;
  performanceDist[bucket(emp.performanceScore)]++;
}
```

For a team of 20 employees this is trivial. But if a report covers 500 employees across multiple teams, it adds up.

---

### Step C: Create the AnalyticsController

Create `backend/src/analytics/analytics.controller.ts`:

```typescript
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

type AuthUser = { id: string; email: string; role: string };

@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  // GET /analytics/team/:teamId
  // All authenticated roles — TEAM_MANAGER scoping handled in service
  @Get('team/:teamId')
  getTeamAnalytics(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.analyticsService.getTeamAnalytics(teamId, user.id, user.role);
  }
}
```

**No `@Roles()` on this controller — why?**

All authenticated users should be able to view analytics for teams they have access to (TEAM_MANAGER is scoped in the service, same as teams/employees). Blocking VIEWER from analytics would prevent them from seeing the data they're supposed to review. The service handles the TEAM_MANAGER scoping check explicitly.

---

### Step D: Create the AnalyticsModule

Create `backend/src/analytics/analytics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  // Export AnalyticsService for use in ReportsModule (Phase 6)
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

---

### Step E: Register AnalyticsModule in AppModule

Update `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { AuditModule } from './audit/audit.module.js';
import { TeamsModule } from './teams/teams.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AuditModule,
    TeamsModule,
    EmployeesModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

---

## How to Verify It Worked

Start the backend:

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

Use **`backend/test-requests/analytics.http`** — open in VS Code and click **Send Request**.

### Expected results:

| Test | Expected |
|------|----------|
| GET /analytics/team/:id without token | 401 |
| GET /analytics/team/:id with ADMIN | 200 + full analytics object |
| All `averages` fields present and non-zero | ✅ (seeded data is realistic) |
| `distributions.engagement` sums to employeeCount | e.g., `5 + 8 + 7 = 20` |
| `riskIndicators` values are 0–100 (percentages) | ✅ |
| GET with TEAM_MANAGER (not their team) | 403 |
| GET with non-existent teamId | 404 |

---

## Checklist (confirm before Step 4)

- [ ] `analytics.service.ts` — computes averages, distributions, riskIndicators in-memory
- [ ] Score thresholds and risk thresholds defined as named constants at the top
- [ ] Empty team case handled gracefully (returns null fields + message)
- [ ] TEAM_MANAGER scoping: 403 if not assigned to the team
- [ ] `analytics.controller.ts` — `GET /analytics/team/:teamId` with `ParseUUIDPipe`
- [ ] `analytics.module.ts` — exports AnalyticsService
- [ ] `app.module.ts` updated — AnalyticsModule imported
- [ ] Test: GET analytics with ADMIN → 200 + all fields present
- [ ] Test: `distributions.engagement.low + medium + high === employeeCount`
- [ ] Test: all `riskIndicators` are numbers between 0 and 100
- [ ] Test: TEAM_MANAGER calls on unassigned team → 403
- [ ] Test: non-existent teamId → 404

---

Once confirmed, move to **Step 4: Phase 3 Final Verification** — testing all CRUD endpoints together, confirming RBAC scoping works end-to-end across Teams, Employees, and Analytics.
