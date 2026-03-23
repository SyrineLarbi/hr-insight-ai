# Phase 2 - Step 3: AuditModule — Interceptor + Logs + Query Endpoint

## Why Are We Doing This?

In a corporate HR platform, **every mutation must be traceable**. Questions like:
- "Who changed this employee's salary last Tuesday?"
- "Who deleted team 'Platform Engineering'?"
- "Which HR manager ran 47 reports in 10 minutes?"

These are compliance, security, and accountability questions. An **audit trail** answers all of them automatically, without developers needing to remember to add logging to each endpoint.

We implement this with a **NestJS Interceptor** — a cross-cutting concern that wraps every request/response cycle. Like middleware, but with access to the full NestJS execution context and the response body.

---

## How NestJS Interceptors Work

```
Request arrives
      │
      ▼
 [Interceptor] — runs BEFORE handler (captures start time, request data)
      │
      ▼
 [Route Handler] — your @Post(), @Patch(), @Delete() method runs
      │
      ▼
 [Interceptor] — runs AFTER handler (captures response body, logs to DB)
      │
      ▼
Response sent to client
```

The interceptor uses **RxJS observables**. The handler returns an observable — we call `tap()` on it to run a side effect (audit logging) after the handler completes, without modifying the response.

Key advantage over middleware: the interceptor can read the **response body**, which lets us capture the created entity's ID in the audit log.

---

## What We're Building

```
src/audit/
  dto/
    query-audit.dto.ts     ← query params: userId, action, entityType, from, to, page, limit
    index.ts               ← barrel export
  audit.interceptor.ts     ← auto-logs all POST/PATCH/DELETE mutations
  audit.service.ts         ← logAction() + findAll() with pagination
  audit.controller.ts      ← GET /audit-logs (ADMIN + HR_MANAGER only)
  audit.module.ts          ← wires everything, exports AuditService

src/app.module.ts          ← MODIFIED: imports AuditModule + APP_INTERCEPTOR registration
test-requests/audit.http   ← REST Client test file
```

---

## The Steps

### Step A: Create the Query DTO

The `GET /audit-logs` endpoint accepts optional filters via query parameters. We use a DTO with `@IsOptional()` validators.

Create `backend/src/audit/dto/query-audit.dto.ts`:

```typescript
import {
  IsOptional,
  IsEnum,
  IsString,
  IsDateString,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction } from '@prisma/client';

export class QueryAuditDto {
  // Filter by which user performed the action
  @IsOptional()
  @IsString()
  userId?: string;

  // Filter by action type (CREATE, UPDATE, DELETE, GENERATE_REPORT, EXPORT_PDF, LOGIN)
  @IsOptional()
  @IsEnum(AuditAction, {
    message: 'action must be one of: CREATE, UPDATE, DELETE, GENERATE_REPORT, EXPORT_PDF, LOGIN',
  })
  action?: AuditAction;

  // Filter by entity type (USER, TEAM, EMPLOYEE, REPORT)
  @IsOptional()
  @IsString()
  entityType?: string;

  // Filter by date range — ISO 8601 string e.g. "2026-01-01T00:00:00Z"
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Pagination — page starts at 1, limit max 100
  @IsOptional()
  @Type(() => Number)   // auto-convert "2" (string from URL) → 2 (number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}
```

**Why `@Type(() => Number)`?**
URL query params are always strings: `?page=2&limit=10`. Without `@Type(() => Number)`, `@IsNumber()` would fail because "2" is a string. `@Type()` from `class-transformer` converts it before validation runs. This works because `main.ts` has `transform: true` in `ValidationPipe`.

Create `backend/src/audit/dto/index.ts`:

```typescript
export { QueryAuditDto } from './query-audit.dto.js';
```

---

### Step B: Create the AuditService

The service has two responsibilities:
1. `log()` — write one audit entry (called by the interceptor + manually by services)
2. `findAll()` — query with filters and pagination

Create `backend/src/audit/audit.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryAuditDto } from './dto/index.js';

// Type for what the interceptor (and services) pass to log()
export interface AuditLogInput {
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  // ============================
  // LOG A SINGLE ACTION
  // Called by the interceptor (automatically) and by services (manually for special actions)
  // ============================
  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        ipAddress: input.ipAddress ?? null,
        metadata: input.metadata ?? {},
      },
    });
  }

  // ============================
  // QUERY AUDIT LOGS (with filters + pagination)
  // ============================
  async findAll(query: QueryAuditDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Build the WHERE clause dynamically from provided filters
    const where: Record<string, unknown> = {};

    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;

    // Date range filter
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.gte = new Date(query.from);
      if (query.to) createdAt.lte = new Date(query.to);
      where.createdAt = createdAt;
    }

    // Run count + data fetch in parallel for performance
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          // Join user info so the frontend can show "John Smith (ADMIN) did X"
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' }, // newest first
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
```

**Why `Promise.all([count, findMany])`?**
Running the count query and the data query sequentially would take 2× the time. `Promise.all` runs them in parallel — both hit the database at the same time and we wait for both to finish. For a table with millions of audit logs, this matters.

---

### Step C: Create the AuditInterceptor

This is the core of the module — the interceptor that automatically logs every mutation.

Create `backend/src/audit/audit.interceptor.ts`:

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service.js';

// Maps URL path segments to human-readable entity type strings
const ENTITY_TYPE_MAP: Record<string, string> = {
  users: 'USER',
  teams: 'TEAM',
  employees: 'EMPLOYEE',
  reports: 'REPORT',
  'audit-logs': 'AUDIT_LOG',
};

// Maps HTTP methods to AuditAction enum values
const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PATCH: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      user?: { id: string };
      ip: string;
      body: Record<string, unknown>;
    }>();

    const { method, url, user, ip, body } = request;

    // Only log mutations (POST, PATCH, DELETE) — not GETs
    if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip auth routes — login/register are handled separately
    if (url.startsWith('/auth/')) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      // tap() runs AFTER the handler completes, without modifying the response
      tap(async (responseBody: Record<string, unknown> | null) => {
        try {
          // If no user on request, skip (shouldn't happen with global JWT guard)
          if (!user?.id) return;

          const action = this.resolveAction(method, url);
          const entityType = this.resolveEntityType(url);
          const entityId = this.resolveEntityId(url, responseBody);

          await this.auditService.log({
            userId: user.id,
            action,
            entityType,
            entityId,
            ipAddress: ip,
            metadata: {
              url,
              method,
              durationMs: Date.now() - startTime,
              // Log request body but strip password fields
              requestBody: this.sanitizeBody(body),
            },
          });
        } catch (error) {
          // NEVER let audit logging crash the request
          // Log the error for debugging but let the response go through
          this.logger.error('Audit logging failed', error);
        }
      }),
    );
  }

  // ─────────────────────────────────────────
  // Determine audit action from HTTP method + URL
  // ─────────────────────────────────────────
  private resolveAction(method: string, url: string): AuditAction {
    // Special cases override the default method-based mapping
    if (url.includes('/generate')) return AuditAction.GENERATE_REPORT;
    if (url.includes('/pdf')) return AuditAction.EXPORT_PDF;

    return METHOD_TO_ACTION[method] ?? AuditAction.CREATE;
  }

  // ─────────────────────────────────────────
  // Determine entity type from URL path
  // e.g., /users/123/assign-teams → "USER"
  //       /teams/456 → "TEAM"
  // ─────────────────────────────────────────
  private resolveEntityType(url: string): string {
    // Remove query string, split into path segments, take first non-empty segment
    const path = url.split('?')[0];
    const segments = path.split('/').filter(Boolean);
    const firstSegment = segments[0] ?? '';
    return ENTITY_TYPE_MAP[firstSegment] ?? firstSegment.toUpperCase();
  }

  // ─────────────────────────────────────────
  // Extract entity ID — try response body first, then URL UUID
  // ─────────────────────────────────────────
  private resolveEntityId(
    url: string,
    responseBody: Record<string, unknown> | null,
  ): string | null {
    // For CREATE: response body has the new entity's ID
    if (typeof responseBody?.id === 'string') return responseBody.id;
    // For auth responses: { user: { id: "..." } }
    const nested = responseBody?.user as Record<string, unknown> | undefined;
    if (typeof nested?.id === 'string') return nested.id;

    // For UPDATE/DELETE: extract UUID from URL path
    const uuidRegex =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = url.match(uuidRegex);
    return match ? match[0] : null;
  }

  // ─────────────────────────────────────────
  // Remove sensitive fields before logging the request body
  // ─────────────────────────────────────────
  private sanitizeBody(
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!body || typeof body !== 'object') return {};
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, passwordHash, ...safe } = body;
    return safe;
  }
}
```

**Why `tap()` instead of `map()`?**
- `map()` transforms the value — we'd be modifying the response
- `tap()` runs a side effect without changing the value — the original response passes through unchanged

**Why wrap the logging in `try/catch`?**
If the database is temporarily unreachable, we don't want a failed audit log to cause a 500 error for a user who just created a team. The action already succeeded — we log the audit failure to our server logger and move on.

---

### Step D: Create the AuditController

Create `backend/src/audit/audit.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from './audit.service.js';
import { QueryAuditDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@Controller('audit-logs')
@Roles(Role.ADMIN, Role.HR_MANAGER)  // Only these two roles can view audit logs
export class AuditController {
  constructor(private auditService: AuditService) {}

  // GET /audit-logs
  // GET /audit-logs?action=DELETE&from=2026-01-01&page=1&limit=20
  @Get()
  findAll(@Query() query: QueryAuditDto) {
    return this.auditService.findAll(query);
  }
}
```

---

### Step E: Create the AuditModule

Create `backend/src/audit/audit.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  // Export AuditService so other modules (ReportsModule in Phase 6) can inject it
  // for manual logging of GENERATE_REPORT and EXPORT_PDF actions
  exports: [AuditService],
})
export class AuditModule {}
```

---

### Step F: Register AuditModule + Interceptor globally in AppModule

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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guards run in registration order: JWT first, then Roles
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Interceptor runs on every request, after guards
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

**Order matters:** Guards run before the handler. Interceptors wrap the handler. So the execution order is:
```
JwtAuthGuard → RolesGuard → [AuditInterceptor starts] → Handler → [AuditInterceptor logs]
```
By the time `AuditInterceptor` runs, `request.user` is guaranteed to be set (JWT guard already validated the token).

---

## How to Verify It Worked

Start the backend:

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

Use `backend/test-requests/audit.http`.

### What to test:

| Test | Expected |
|------|----------|
| GET /audit-logs without token | 401 |
| GET /audit-logs with VIEWER token | 403 |
| GET /audit-logs with ADMIN token | 200 + paginated data |
| GET /audit-logs with HR_MANAGER token | 200 + paginated data |
| Create a user then check audit logs | New CREATE entry appears |
| Delete a user then check audit logs | DELETE entry appears |
| Filter by `?action=DELETE` | Only DELETE entries |
| Filter by `?from=2026-01-01&to=2026-12-31` | Date-filtered entries |
| Filter by `?page=1&limit=5` | Max 5 items, meta shows totalPages |

---

## Checklist (confirm before Phase 2 complete)

- [ ] `audit/dto/query-audit.dto.ts` with all optional filter fields + `@Type(() => Number)`
- [ ] `audit/dto/index.ts` barrel export
- [ ] `audit.service.ts` — `log()` and `findAll()` with pagination
- [ ] `audit.interceptor.ts` — auto-logs POST/PATCH/DELETE, skips `/auth/`, never crashes requests
- [ ] `audit.controller.ts` — `@Roles(Role.ADMIN, Role.HR_MANAGER)` on class
- [ ] `audit.module.ts` — exports AuditService
- [ ] `app.module.ts` — imports AuditModule, registers `APP_INTERCEPTOR`
- [ ] Test: GET /audit-logs without token → 401
- [ ] Test: GET /audit-logs with VIEWER token → 403
- [ ] Test: GET /audit-logs with ADMIN token → 200 with paginated data
- [ ] Test: create something → check audit-logs → new CREATE entry visible
- [ ] Test: filter by `?action=DELETE` → only DELETE entries
- [ ] Test: pagination `?page=1&limit=5` → max 5 items + meta.totalPages

---

Once Step 2 and Step 3 are both confirmed, **Phase 2 is complete**. We'll move to **Phase 3: TeamsModule + EmployeesModule + RBAC scoping** — where TEAM_MANAGERs can only see their assigned teams.
