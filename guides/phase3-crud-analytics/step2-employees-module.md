# Phase 3 - Step 2: EmployeesModule — CRUD + RBAC Scoping

## Why Are We Doing This?

Employees are the **raw material** of the entire platform. Without employees:
- There is nothing for the ML model to predict on
- There is nothing for the analytics to aggregate
- Reports cannot be generated

Each employee row contains the 8 features the ML model uses: salary, tenure, engagement score, performance score, absenteeism days, overtime hours, months since last promotion, and training hours. Data quality here directly affects prediction quality — garbage in, garbage out.

The RBAC challenge is more layered than for teams:
- A TEAM_MANAGER can add/edit employees **only in their assigned teams** — not other teams
- When filtering employees, TEAM_MANAGER sees **only employees whose team is assigned to them**
- A VIEWER can see employees but cannot create or modify them

---

## How Employee RBAC Scoping Works

Employees belong to teams. Teams are assigned to TEAM_MANAGERs via `team_assignments`. So to scope employees, we scope by team:

```
ADMIN calls GET /employees:
  prisma.employee.findMany({ }) → all 60 employees

TEAM_MANAGER calls GET /employees:
  prisma.employee.findMany({
    where: {
      team: {
        teamAssignments: {
          some: { userId: "uuid" }
        }
      }
    }
  }) → only employees in their assigned teams

ADMIN calls GET /employees?teamId=xyz:
  prisma.employee.findMany({
    where: { teamId: "xyz" }
  }) → all employees in that specific team
```

When a `teamId` filter AND role scoping are both active, Prisma's `where` merges them with an implicit AND.

---

## What We're Building

```
backend/src/employees/
  dto/
    create-employee.dto.ts    ← all 9 employee fields with range validation
    update-employee.dto.ts    ← all fields optional
    index.ts                  ← barrel export
  employees.service.ts        ← CRUD with RBAC scoping + team ownership check
  employees.controller.ts     ← GET (query ?teamId), GET :id, POST, PATCH, DELETE
  employees.module.ts

backend/src/app.module.ts     ← MODIFIED: imports EmployeesModule
backend/test-requests/
  employees.http              ← REST Client test file for this step
```

---

## The Steps

### Step A: Create the folder structure

```bash
mkdir -p /home/syrine/hr-insight-ai/backend/src/employees/dto
```

---

### Step B: Create the DTOs

Employee DTOs are the most detailed in the project — 9 fields with numeric range validation.

Create `backend/src/employees/dto/create-employee.dto.ts`:

```typescript
import {
  IsString,
  IsNumber,
  IsUUID,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmployeeDto {
  @IsUUID('4', { message: 'teamId must be a valid UUID' })
  teamId: string;

  @IsString()
  @MinLength(2, { message: 'Employee name must be at least 2 characters' })
  @MaxLength(100, { message: 'Employee name must not exceed 100 characters' })
  name: string;

  // Annual salary in USD — must be positive
  @Type(() => Number)
  @IsNumber({}, { message: 'Salary must be a number' })
  @Min(1, { message: 'Salary must be greater than 0' })
  salary: number;

  // How long they have been at the company in months
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Tenure months cannot be negative' })
  tenureMonths: number;

  // From HR survey, 1 (very disengaged) to 5 (highly engaged)
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Engagement score must be between 1 and 5' })
  @Max(5, { message: 'Engagement score must be between 1 and 5' })
  engagementScore: number;

  // From performance review, 1 (poor) to 5 (exceptional)
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Performance score must be between 1 and 5' })
  @Max(5, { message: 'Performance score must be between 1 and 5' })
  performanceScore: number;

  // Number of days absent in the last 12 months
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Absenteeism days cannot be negative' })
  absenteeismDays: number;

  // Weekly overtime hours (above standard 40h)
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Overtime hours cannot be negative' })
  overtimeHours: number;

  // How many months ago was their last promotion (0 = recent)
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Last promotion months cannot be negative' })
  lastPromotionMonths: number;

  // Total training hours completed
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Training hours cannot be negative' })
  trainingHours: number;
}
```

Create `backend/src/employees/dto/update-employee.dto.ts`:

```typescript
import { IsString, IsNumber, IsUUID, IsOptional, Min, Max, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateEmployeeDto {
  @IsOptional()
  @IsUUID('4')
  teamId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  salary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tenureMonths?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  engagementScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  performanceScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  absenteeismDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lastPromotionMonths?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  trainingHours?: number;
}
```

Create `backend/src/employees/dto/index.ts`:

```typescript
export { CreateEmployeeDto } from './create-employee.dto.js';
export { UpdateEmployeeDto } from './update-employee.dto.js';
```

---

### Step C: Create the EmployeesService

Create `backend/src/employees/employees.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/index.js';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  // ============================
  // LIST EMPLOYEES
  // Optional ?teamId filter + RBAC scoping
  // ============================
  async findAll(
    teamId: string | undefined,
    userId: string,
    userRole: string,
  ) {
    // Start with optional teamId filter
    const where: Record<string, unknown> = {};
    if (teamId) where.teamId = teamId;

    // TEAM_MANAGER sees only employees from their assigned teams
    if (userRole === 'TEAM_MANAGER') {
      where.team = {
        teamAssignments: {
          some: { userId },
        },
      };
    }

    return this.prisma.employee.findMany({
      where,
      include: {
        team: {
          select: { id: true, name: true, department: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ============================
  // GET ONE EMPLOYEE
  // ============================
  async findOne(id: string, userId: string, userRole: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true, department: true } },
        riskSnapshots: {
          orderBy: { snapshotDate: 'desc' },
          take: 10, // last 10 snapshots for the risk timeline
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id "${id}" not found`);
    }

    // TEAM_MANAGER can only view employees in their assigned teams
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(employee.teamId, userId);
    }

    return employee;
  }

  // ============================
  // CREATE EMPLOYEE (HR_MANAGER+ or TEAM_MANAGER for their team)
  // ============================
  async create(dto: CreateEmployeeDto, userId: string, userRole: string) {
    // TEAM_MANAGER can only add employees to their assigned teams
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(dto.teamId, userId);
    }

    // Verify the target team exists
    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });
    if (!team) {
      throw new NotFoundException(`Team with id "${dto.teamId}" not found`);
    }

    return this.prisma.employee.create({ data: dto });
  }

  // ============================
  // UPDATE EMPLOYEE
  // ============================
  async update(
    id: string,
    dto: UpdateEmployeeDto,
    userId: string,
    userRole: string,
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with id "${id}" not found`);
    }

    // TEAM_MANAGER can only update employees in their assigned teams
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(employee.teamId, userId);
    }

    // If teamId is being changed, verify the new team exists
    if (dto.teamId && dto.teamId !== employee.teamId) {
      const newTeam = await this.prisma.team.findUnique({
        where: { id: dto.teamId },
      });
      if (!newTeam) {
        throw new NotFoundException(`Team with id "${dto.teamId}" not found`);
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data: dto,
    });
  }

  // ============================
  // DELETE EMPLOYEE (HR_MANAGER+)
  // ============================
  async remove(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with id "${id}" not found`);
    }

    await this.prisma.employee.delete({ where: { id } });
    return { message: `Employee "${employee.name}" deleted successfully` };
  }

  // ─────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Throws ForbiddenException if the user is not assigned to the given team.
   * Used to enforce TEAM_MANAGER scoping on individual employee operations.
   */
  private async assertTeamAccess(teamId: string, userId: string) {
    const assignment = await this.prisma.teamAssignment.findFirst({
      where: { userId, teamId },
    });
    if (!assignment) {
      throw new ForbiddenException(
        'You do not have access to employees in this team',
      );
    }
  }
}
```

**Why does `findOne` check team access AFTER fetching the employee?**

For `findOne`, we need the employee to exist first to know which `teamId` to check access against. The security trade-off: a TEAM_MANAGER who guesses an employee UUID from another team gets 403 (not 404), but they do learn the employee exists. This is acceptable because:
- Employee UUIDs are not guessable (random UUID v4)
- The 403 reveals the employee exists but nothing else about them

---

### Step D: Create the EmployeesController

Create `backend/src/employees/employees.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  IsOptional,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { EmployeesService } from './employees.service.js';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

type AuthUser = { id: string; email: string; role: string };

@Controller('employees')
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  // GET /employees — all authenticated roles (data scoped in service)
  // GET /employees?teamId=uuid — filter by team (still RBAC-scoped)
  @Get()
  findAll(
    @Query('teamId') teamId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.findAll(teamId, user.id, user.role);
  }

  // GET /employees/:id — all authenticated roles (access check in service)
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.findOne(id, user.id, user.role);
  }

  // POST /employees — HR_MANAGER+, TEAM_MANAGER (scoped to their team)
  @Post()
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.create(dto, user.id, user.role);
  }

  // PATCH /employees/:id — HR_MANAGER+, TEAM_MANAGER (scoped)
  @Patch(':id')
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.update(id, dto, user.id, user.role);
  }

  // DELETE /employees/:id — HR_MANAGER+ only (TEAM_MANAGER cannot delete)
  @Delete(':id')
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.remove(id);
  }
}
```

**Access matrix:**

| Route | ADMIN | HR_MANAGER | TEAM_MANAGER | VIEWER |
|-------|-------|------------|--------------|--------|
| GET /employees | All | All | Own teams only | All |
| GET /employees/:id | Any | Any | Own team only | Any |
| POST /employees | Any team | Any team | Own team only | ❌ 403 |
| PATCH /employees/:id | Any | Any | Own team only | ❌ 403 |
| DELETE /employees/:id | ✅ | ✅ | ❌ 403 | ❌ 403 |

---

### Step E: Create the EmployeesModule

Create `backend/src/employees/employees.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service.js';
import { EmployeesController } from './employees.controller.js';

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
```

---

### Step F: Register EmployeesModule in AppModule

Update `backend/src/app.module.ts` — add `EmployeesModule`:

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

Use **`backend/test-requests/employees.http`** — open in VS Code and click **Send Request**.

### Expected results:

| Test | Expected |
|------|----------|
| GET /employees without token | 401 |
| GET /employees with ADMIN | 200 + all 60 seeded employees with team info |
| GET /employees?teamId=X with ADMIN | 200 + employees in that team only |
| GET /employees with TEAM_MANAGER | 200 + only employees in assigned team |
| POST /employees with TEAM_MANAGER (other team's teamId) | 403 |
| POST /employees with valid data and ADMIN | 201 + new employee |
| PATCH with invalid score (e.g., engagementScore: 6) | 400 Bad Request |
| DELETE /employees/:id with TEAM_MANAGER | 403 |

---

## Checklist (confirm before Step 3)

- [ ] `employees/dto/create-employee.dto.ts` — all 9 fields, `@Min`/`@Max` on scores
- [ ] `employees/dto/update-employee.dto.ts` — all fields optional
- [ ] `employees/dto/index.ts` barrel export
- [ ] `employees.service.ts` — `findAll` scopes by `team.teamAssignments` for TEAM_MANAGER
- [ ] `employees.service.ts` — `create` checks team access before inserting
- [ ] `employees.controller.ts` — `?teamId` query param on `findAll`
- [ ] `employees.module.ts` — exports EmployeesService
- [ ] `app.module.ts` updated — EmployeesModule imported
- [ ] Test: GET /employees with TEAM_MANAGER → only employees in assigned team
- [ ] Test: POST /employees with TEAM_MANAGER + another team's teamId → 403
- [ ] Test: PATCH with engagementScore 6 → 400 validation error
- [ ] Test: DELETE with TEAM_MANAGER → 403

---

Once confirmed, move to **Step 3: AnalyticsModule** — compute team-level aggregated metrics (averages, distributions, risk indicators) from live employee data.
