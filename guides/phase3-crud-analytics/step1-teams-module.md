# Phase 3 - Step 1: TeamsModule — CRUD + RBAC Scoping

## Why Are We Doing This?

Phase 2 built the security layer. Phase 3 puts real data behind it.

`Teams` are the core organizational unit of the platform. Every employee belongs to a team. Every report is generated for a team. Every TEAM_MANAGER is scoped to one or more teams. Without the TeamsModule, there is nothing to analyze.

The interesting challenge here is **RBAC data scoping** — the same `GET /teams` endpoint must return different data depending on who calls it:

- **ADMIN / HR_MANAGER**: see all 3 teams in the database
- **TEAM_MANAGER**: see only the teams they're assigned to (via `team_assignments`)
- **VIEWER**: see all teams (read-only)

This is NOT done with different routes. It's done in the **service layer** — one route, one controller method, but the Prisma query changes its `WHERE` clause based on `request.user.role`. This pattern is the foundation for all scoped queries in Phase 3.

---

## How RBAC Scoping Works in Prisma

```
ADMIN calls GET /teams:
  prisma.team.findMany({ }) → returns all 3 teams

TEAM_MANAGER calls GET /teams:
  prisma.team.findMany({
    where: {
      teamAssignments: {        ← filter by relation
        some: { userId: "uuid" }  ← at least one assignment for this user
      }
    }
  }) → returns only 1 or 2 teams
```

Prisma's `where` with nested relations (`teamAssignments.some`) lets us filter teams by whether the current user has a `team_assignments` row for them. No extra join table logic — Prisma handles the JOIN automatically.

---

## What We're Building

```
backend/src/teams/
  dto/
    create-team.dto.ts      ← { name, department }
    update-team.dto.ts      ← both fields optional
    index.ts                ← barrel export
  teams.service.ts          ← CRUD with RBAC scoping in findAll + findOne
  teams.controller.ts       ← routes: GET (all), GET (one), POST, PATCH, DELETE
  teams.module.ts           ← wires everything

backend/src/app.module.ts   ← MODIFIED: imports TeamsModule
backend/test-requests/
  teams.http                ← REST Client test file for this step
```

---

## The Steps

### Step A: Create the folder structure

```bash
mkdir -p /home/syrine/hr-insight-ai/backend/src/teams/dto
```

---

### Step B: Create the DTOs

DTOs validate incoming request bodies before they reach the service. If a required field is missing or has the wrong type, NestJS rejects the request with a 400 before any database query runs.

Create `backend/src/teams/dto/create-team.dto.ts`:

```typescript
import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(2, { message: 'Team name must be at least 2 characters' })
  @MaxLength(100, { message: 'Team name must not exceed 100 characters' })
  name: string;

  @IsString()
  @MinLength(2, { message: 'Department must be at least 2 characters' })
  @MaxLength(100, { message: 'Department must not exceed 100 characters' })
  department: string;
}
```

Create `backend/src/teams/dto/update-team.dto.ts`:

```typescript
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Team name must be at least 2 characters' })
  @MaxLength(100, { message: 'Team name must not exceed 100 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Department must be at least 2 characters' })
  @MaxLength(100, { message: 'Department must not exceed 100 characters' })
  department?: string;
}
```

**Why not use `PartialType(CreateTeamDto)`?**

`PartialType` from `@nestjs/mapped-types` would automatically make all fields optional — same result, less code. However it requires a separate package install and adds a dependency. Since we only have 2 fields, writing it explicitly is clearer and has zero risk of package version issues.

Create `backend/src/teams/dto/index.ts`:

```typescript
export { CreateTeamDto } from './create-team.dto.js';
export { UpdateTeamDto } from './update-team.dto.js';
```

---

### Step C: Create the TeamsService

This is where the RBAC scoping logic lives. Note that `findAll` and `findOne` both accept `userId` and `userRole` — passed down from the controller via `@CurrentUser()`.

Create `backend/src/teams/teams.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTeamDto, UpdateTeamDto } from './dto/index.js';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  // ============================
  // LIST ALL TEAMS
  // TEAM_MANAGER: only sees assigned teams
  // ADMIN / HR_MANAGER / VIEWER: sees all teams
  // ============================
  async findAll(userId: string, userRole: string) {
    // Build the WHERE clause based on role
    const where =
      userRole === 'TEAM_MANAGER'
        ? {
            teamAssignments: {
              some: { userId }, // team must have at least one assignment for this user
            },
          }
        : {}; // empty WHERE = no filter = return all

    return this.prisma.team.findMany({
      where,
      include: {
        _count: {
          select: { employees: true }, // adds employeeCount to each team
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ============================
  // GET ONE TEAM (with employees)
  // ============================
  async findOne(id: string, userId: string, userRole: string) {
    // TEAM_MANAGER must be assigned to this team
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(id, userId);
    }

    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        employees: {
          orderBy: { name: 'asc' },
        },
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!team) throw new NotFoundException(`Team with id "${id}" not found`);
    return team;
  }

  // ============================
  // CREATE TEAM (HR_MANAGER+)
  // ============================
  async create(dto: CreateTeamDto) {
    return this.prisma.team.create({
      data: {
        name: dto.name,
        department: dto.department,
      },
    });
  }

  // ============================
  // UPDATE TEAM
  // TEAM_MANAGER: only their assigned teams
  // HR_MANAGER / ADMIN: any team
  // ============================
  async update(
    id: string,
    dto: UpdateTeamDto,
    userId: string,
    userRole: string,
  ) {
    // TEAM_MANAGER can only update their own teams
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(id, userId);
    }

    await this.assertTeamExists(id);

    return this.prisma.team.update({
      where: { id },
      data: dto,
    });
  }

  // ============================
  // DELETE TEAM (ADMIN only)
  // Prisma schema has onDelete: Cascade on employees → employees are deleted too
  // ============================
  async remove(id: string) {
    await this.assertTeamExists(id);

    await this.prisma.team.delete({ where: { id } });
    return { message: `Team "${id}" deleted successfully` };
  }

  // ─────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Throws 403 if the given user does not have a team_assignments row for this team.
   * Used to enforce TEAM_MANAGER scoping on individual team operations.
   */
  private async assertTeamAccess(teamId: string, userId: string) {
    const assignment = await this.prisma.teamAssignment.findFirst({
      where: { userId, teamId },
    });
    if (!assignment) {
      throw new ForbiddenException(
        'You do not have access to this team',
      );
    }
  }

  /**
   * Throws 404 if the team doesn't exist.
   * Checked before UPDATE/DELETE to give a clear error instead of Prisma's
   * "Record to update not found" error.
   */
  private async assertTeamExists(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException(`Team with id "${id}" not found`);
  }
}
```

**Key design decision — why check access BEFORE existence?**

In `assertTeamAccess` → `assertTeamExists` order (for UPDATE):
- If we check existence first and the team doesn't exist, we return 404 → leaks info (TEAM_MANAGER learns this team ID doesn't exist)
- If we check access first and they don't have access, we return 403 → tells them nothing about whether the team exists

For TEAM_MANAGER, checking access first is the more secure pattern. For our service, we check access first, then existence — so a TEAM_MANAGER who guesses a random UUID gets 403 (not 404).

---

### Step D: Create the TeamsController

Create `backend/src/teams/teams.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeamsService } from './teams.service.js';
import { CreateTeamDto, UpdateTeamDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

type AuthUser = { id: string; email: string; role: string };

@Controller('teams')
export class TeamsController {
  constructor(private teamsService: TeamsService) {}

  // GET /teams — all authenticated roles (data scoped in service)
  // No @Roles() → RolesGuard allows any authenticated user
  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.teamsService.findAll(user.id, user.role);
  }

  // GET /teams/:id — all authenticated roles (access check in service)
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.teamsService.findOne(id, user.id, user.role);
  }

  // POST /teams — HR_MANAGER and ADMIN only
  @Post()
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  // PATCH /teams/:id — HR_MANAGER+, TEAM_MANAGER scoped to their teams
  @Patch(':id')
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.teamsService.update(id, dto, user.id, user.role);
  }

  // DELETE /teams/:id — ADMIN only (cascades to all employees + reports)
  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.teamsService.remove(id);
  }
}
```

**Access matrix for this controller:**

| Route | ADMIN | HR_MANAGER | TEAM_MANAGER | VIEWER |
|-------|-------|------------|--------------|--------|
| GET /teams | All | All | Own only | All |
| GET /teams/:id | Any | Any | Own only (403 if not assigned) | Any |
| POST /teams | ✅ | ✅ | ❌ 403 | ❌ 403 |
| PATCH /teams/:id | Any | Any | Own only | ❌ 403 |
| DELETE /teams/:id | ✅ | ❌ 403 | ❌ 403 | ❌ 403 |

---

### Step E: Create the TeamsModule

Create `backend/src/teams/teams.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service.js';
import { TeamsController } from './teams.controller.js';

@Module({
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
```

**Why `exports: [TeamsService]`?**
`AnalyticsModule` (Step 3) and `ReportsModule` (Phase 6) will need to fetch team data. Exporting `TeamsService` lets them inject it without duplicating Prisma queries.

---

### Step F: Register TeamsModule in AppModule

Update `backend/src/app.module.ts` — add `TeamsModule` to the imports array:

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

Use **`backend/test-requests/teams.http`** — open in VS Code and click **Send Request** above each block.

### Expected results:

| Test | Expected |
|------|----------|
| GET /teams without token | 401 Unauthorized |
| GET /teams with ADMIN token | 200 + all 3 seeded teams, each with `_count.employees` |
| GET /teams with TEAM_MANAGER token | 200 + only "Platform Engineering" (seeded assignment) |
| GET /teams with VIEWER token | 200 + all 3 teams |
| POST /teams with HR_MANAGER | 201 + new team |
| POST /teams with TEAM_MANAGER | 403 Forbidden |
| PATCH /teams/:id with TEAM_MANAGER (not assigned) | 403 Forbidden |
| DELETE /teams/:id with HR_MANAGER | 403 Forbidden (ADMIN only) |
| DELETE /teams/:id with ADMIN | 200 + success message |

---

## Checklist (confirm before Step 2)

- [ ] `teams/dto/create-team.dto.ts` — `name` and `department` with length validation
- [ ] `teams/dto/update-team.dto.ts` — both fields optional
- [ ] `teams/dto/index.ts` barrel export
- [ ] `teams.service.ts` — RBAC scoping in `findAll` (WHERE by teamAssignments), `assertTeamAccess` helper
- [ ] `teams.controller.ts` — `@Roles()` on POST (HR_MANAGER+), PATCH (TM+), DELETE (ADMIN)
- [ ] `teams.module.ts` — exports TeamsService
- [ ] `app.module.ts` updated — TeamsModule imported
- [ ] Test: GET /teams with ADMIN → 200 + all teams with `_count`
- [ ] Test: GET /teams with TEAM_MANAGER → 200 + only assigned team
- [ ] Test: POST /teams with TEAM_MANAGER → 403
- [ ] Test: PATCH /teams/:id with TEAM_MANAGER (not their team) → 403
- [ ] Test: DELETE /teams/:id with ADMIN → 200

---

Once confirmed, move to **Step 2: EmployeesModule** — CRUD for employees with the same RBAC scoping pattern, applied at the employee level via team membership.
