# Phase 2 - Step 3: AuditModule — Interceptor + Service + Logs Endpoint

## Why Are We Doing This?

In a corporate HR platform, **every mutation must be traceable**. Compliance and security teams need to answer questions like:

- "Who changed employee Sarah's salary last Tuesday?"
- "Who deleted the 'Platform Engineering' team?"
- "Which HR manager generated 47 reports in 10 minutes?"

Right now, if a TEAM_MANAGER changes data they shouldn't be touching, there's no way to know it happened. We need an **audit trail** — a permanent, tamper-evident log of every significant action in the system.

We implement this with a **NestJS Interceptor** — a cross-cutting concern that automatically wraps every request. Like middleware, but smarter: it can read the full NestJS execution context AND the response body (so we can log what entity was created, not just what was requested).

---

## How NestJS Interceptors Work

```
HTTP Request arrives
        │
        ▼
   [JwtAuthGuard]     ← validates token, sets request.user
        │
        ▼
   [RolesGuard]       ← checks user.role against @Roles()
        │
        ▼
 ┌──────────────────────────────────────────────────────┐
 │  [AuditInterceptor] — START                          │
 │  - Reads: method, url, user.id, ip, body             │
 │                                                      │
 │       ▼                                              │
 │  [Route Handler] — your @Post()/@Patch()/@Delete()   │
 │       │                                              │
 │       ▼                                              │
 │  [AuditInterceptor] — END                            │
 │  - Reads: response body (gets the new entity's id)   │
 │  - Writes: audit_logs row to database                │
 └──────────────────────────────────────────────────────┘
        │
        ▼
   Response sent to client
```

The interceptor uses **RxJS observables**. The route handler returns an observable (a stream of values). We call `tap()` on it to run a side effect (write the audit log) without modifying the response value. The client receives the exact same response whether we logged successfully or not.

---

## What We're Building

```
backend/src/audit/
  dto/
    query-audit.dto.ts     ← query params with validation: userId, action, entityType, from, to, page, limit
    index.ts               ← barrel export
  audit.service.ts         ← log() to write an entry, findAll() with filters + pagination
  audit.interceptor.ts     ← auto-logs all POST/PATCH/DELETE requests globally
  audit.controller.ts      ← GET /audit-logs (ADMIN + HR_MANAGER only)
  audit.module.ts          ← wires everything, exports AuditService for Phase 6

backend/src/app.module.ts  ← MODIFIED: import AuditModule + APP_INTERCEPTOR registration
backend/test-requests/
  audit.http               ← REST Client test file (9 tests)
```

---

## The Steps

### Step A: Create the folder structure

```bash
mkdir -p /home/syrine/hr-insight-ai/backend/src/audit/dto
```

---

### Step B: Create the Query DTO

`GET /audit-logs` accepts optional query parameters for filtering. We define them in a DTO so `ValidationPipe` validates and transforms them automatically.

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
  // Filter by which user performed the action (UUID string)
  @IsOptional()
  @IsString()
  userId?: string;

  // Filter by action type: CREATE, UPDATE, DELETE, GENERATE_REPORT, EXPORT_PDF, LOGIN
  @IsOptional()
  @IsEnum(AuditAction, {
    message:
      'action must be one of: CREATE, UPDATE, DELETE, GENERATE_REPORT, EXPORT_PDF, LOGIN',
  })
  action?: AuditAction;

  // Filter by entity type: USER, TEAM, EMPLOYEE, REPORT
  @IsOptional()
  @IsString()
  entityType?: string;

  // Date range — ISO 8601 format: "2026-01-01T00:00:00Z"
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Pagination — page starts at 1, limit capped at 100
  @IsOptional()
  @Type(() => Number)
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

**Why `@Type(() => Number)` on `page` and `limit`?**

URL query parameters are always strings in HTTP. If someone calls `GET /audit-logs?page=2`, NestJS receives `"2"` (the string "2"), not `2` (the number). Without `@Type()`, the `@IsNumber()` validator would fail because `"2" !== 2`.

`@Type(() => Number)` from `class-transformer` converts the string to a number before validation runs. This works because `main.ts` has `transform: true` in `ValidationPipe` — it triggers class-transformer on every incoming DTO.

Create `backend/src/audit/dto/index.ts`:

```typescript
export { QueryAuditDto } from './query-audit.dto.js';
```

---

### Step C: Create the AuditService

The service has two methods:
1. `log()` — called by the interceptor (automatically) and directly by services (for special actions like LOGIN)
2. `findAll()` — query with filters and pagination for the `GET /audit-logs` endpoint

Create `backend/src/audit/audit.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryAuditDto } from './dto/index.js';

// The shape of data the interceptor passes to log()
// Also used by AuthService.login() to log LOGIN actions directly
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
  // QUERY AUDIT LOGS (filters + pagination)
  // ============================
  async findAll(query: QueryAuditDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Build the WHERE clause only from filters that were actually provided
    const where: Record<string, unknown> = {};

    if (query.userId)     where.userId     = query.userId;
    if (query.action)     where.action     = query.action;
    if (query.entityType) where.entityType = query.entityType;

    // Date range: createdAt >= from AND createdAt <= to
    if (query.from || query.to) {
      const createdAt: { gte?: Date; lte?: Date } = {};
      if (query.from) createdAt.gte = new Date(query.from);
      if (query.to)   createdAt.lte = new Date(query.to);
      where.createdAt = createdAt;
    }

    // Run count + data fetch in parallel — both DB queries run simultaneously
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          // Join user info so the frontend can show "John Smith (ADMIN) deleted X"
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

**Why `Promise.all([count, findMany])` instead of sequential awaits?**

```typescript
// Sequential — slow (2 DB round-trips, one after the other):
const total = await prisma.auditLog.count({ where });    // wait ~20ms
const items = await prisma.auditLog.findMany({ where }); // wait ~20ms
// Total: ~40ms

// Parallel — fast (both queries fly at the same time):
const [total, items] = await Promise.all([
  prisma.auditLog.count({ where }),    // starts at t=0
  prisma.auditLog.findMany({ where }), // starts at t=0
]);
// Total: ~20ms (limited by the slower query)
```

For an audit log that might have millions of rows, this difference is significant.

**The `meta` object:**
This is a standard pagination response format. The frontend uses `meta.totalPages` to know how many pages to show and `meta.total` to display "Showing 1-20 of 1,432 entries."

---

### Step D: Create the AuditInterceptor

This is the heart of the module. It automatically logs every POST, PATCH, and DELETE request — you never need to remember to add logging to a new endpoint.

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

// Maps URL first path segment → entity type string stored in audit_logs
const ENTITY_TYPE_MAP: Record<string, string> = {
  users:       'USER',
  teams:       'TEAM',
  employees:   'EMPLOYEE',
  reports:     'REPORT',
  'audit-logs': 'AUDIT_LOG',
};

// Maps HTTP method → AuditAction enum value
const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST:   AuditAction.CREATE,
  PATCH:  AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      user?: { id: string };
      ip: string;
      body: Record<string, unknown>;
    }>();

    const { method, url, user, ip, body } = req;

    // Only intercept mutations — skip GET requests
    if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip auth routes — register/login handled separately
    if (url.startsWith('/auth/')) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      // tap() runs AFTER the handler completes
      // The return value of tap's callback is IGNORED — the original response passes through unchanged
      tap(async (responseBody: Record<string, unknown> | null) => {
        try {
          // Safety check: user might be missing if something bypassed the JWT guard
          if (!user?.id) return;

          const action     = this.resolveAction(method, url);
          const entityType = this.resolveEntityType(url);
          const entityId   = this.resolveEntityId(url, responseBody);

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
              // Log request body but strip any password fields for security
              requestBody: this.sanitizeBody(body),
            },
          });
        } catch (err) {
          // CRITICAL: audit logging must NEVER fail the original request.
          // If the audit_logs table is unreachable, the user's action still succeeded.
          // We log the failure to the server console for debugging.
          this.logger.error('Audit logging failed — original request was NOT affected', err);
        }
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Determine the audit action from the HTTP method and URL.
   * Special-case URLs override the default method mapping.
   */
  private resolveAction(method: string, url: string): AuditAction {
    if (url.includes('/generate')) return AuditAction.GENERATE_REPORT;
    if (url.includes('/pdf'))      return AuditAction.EXPORT_PDF;
    return METHOD_TO_ACTION[method] ?? AuditAction.CREATE;
  }

  /**
   * Extract entity type from the URL's first path segment.
   * /users/123/assign-teams → "USER"
   * /teams                  → "TEAM"
   * /employees/456          → "EMPLOYEE"
   */
  private resolveEntityType(url: string): string {
    // Strip query string, split path, take first non-empty segment
    const cleanUrl  = url.split('?')[0];
    const segments  = cleanUrl.split('/').filter(Boolean);
    const first     = segments[0] ?? '';
    return ENTITY_TYPE_MAP[first] ?? first.toUpperCase();
  }

  /**
   * Extract entity ID — prefer the response body's id field (most reliable for POST).
   * Fall back to extracting a UUID from the URL path (for PATCH/DELETE).
   */
  private resolveEntityId(
    url: string,
    body: Record<string, unknown> | null,
  ): string | null {
    // POST /auth/register and POST /teams etc. return { id: "uuid" }
    if (typeof body?.id === 'string') return body.id;

    // POST /auth/register returns { user: { id: "uuid" } }
    const nested = body?.user as Record<string, unknown> | undefined;
    if (typeof nested?.id === 'string') return nested.id;

    // PATCH /users/uuid or DELETE /teams/uuid — extract UUID from URL
    const uuidRegex =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = url.match(uuidRegex);
    return match ? match[0] : null;
  }

  /**
   * Remove sensitive fields before storing in the metadata JSON.
   * We never log passwords or hashed passwords.
   */
  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
    if (!body || typeof body !== 'object') return {};
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, passwordHash, ...safe } = body as Record<string, unknown>;
    return safe;
  }
}
```

**Why `tap()` and not `map()`?**

| | `tap()` | `map()` |
|--|---------|---------|
| **Purpose** | Run a side effect | Transform the value |
| **Modifies response?** | No | Yes |
| **Return value used?** | Ignored | Replaces the stream value |

We want a side effect (write to DB) without changing what the client receives. `tap()` is exactly that. Using `map()` would require us to return the original value explicitly — error-prone and unnecessary.

**Why `try/catch` inside `tap()`?**

If the audit_logs DB write fails (network blip, DB timeout), we must NOT let that failure propagate back to the client. The user's original action (creating a team, updating a role) **already succeeded**. Throwing an error inside `tap()` would cause a 500 response for something that actually worked. We log the failure to the console for ops to investigate, and let the response go through untouched.

---

### Step E: Create the AuditController

Create `backend/src/audit/audit.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from './audit.service.js';
import { QueryAuditDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@Controller('audit-logs')
@Roles(Role.ADMIN, Role.HR_MANAGER)
export class AuditController {
  constructor(private auditService: AuditService) {}

  // GET /audit-logs
  // GET /audit-logs?action=DELETE&entityType=TEAM&from=2026-01-01&page=1&limit=20
  @Get()
  findAll(@Query() query: QueryAuditDto) {
    return this.auditService.findAll(query);
  }
}
```

**Why `@Roles(Role.ADMIN, Role.HR_MANAGER)` on the class?**

Both ADMIN and HR_MANAGER can see audit logs. TEAM_MANAGER and VIEWER cannot — they'd see other people's actions, which is a privacy/security issue. Putting `@Roles` on the class applies it to all routes in the controller automatically.

---

### Step F: Create the AuditModule

Create `backend/src/audit/audit.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  // Export AuditService so Phase 6 (ReportsModule) can inject it
  // to manually log GENERATE_REPORT and EXPORT_PDF actions
  exports: [AuditService],
})
export class AuditModule {}
```

---

### Step G: Register AuditModule + APP_INTERCEPTOR in AppModule

This is the step that makes everything global. Once registered as `APP_INTERCEPTOR`, `AuditInterceptor` runs on every single request automatically.

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
    // Guards run in order: JWT validates the token first, then Roles checks the role
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Interceptor wraps every request — runs after guards pass
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

**Full request lifecycle with all 3 providers:**

```
HTTP POST /teams
    │
    ▼ JwtAuthGuard: is the token valid? sets request.user = { id, email, role }
    │
    ▼ RolesGuard: does user.role match @Roles() on the controller? HR_MANAGER → ✅
    │
    ▼ AuditInterceptor: record method=POST, url=/teams, userId=user.id, start timer
    │
    ▼ TeamsController.create() runs → returns { id: "new-uuid", name: "..." }
    │
    ▼ AuditInterceptor: read response.id, write audit_log row asynchronously
    │
    ▼ 201 Created response sent to client
```

---

## How to Verify It Worked

Start the backend:

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

Use `backend/test-requests/audit.http` — open in VS Code and click **Send Request** above each block.

### Expected results:

| Test | Expected result |
|------|-----------------|
| GET /audit-logs without token | 401 Unauthorized |
| GET /audit-logs with VIEWER token | 403 Forbidden |
| GET /audit-logs with ADMIN token | 200 + `{ data: [...], meta: { total, page, limit, totalPages } }` |
| GET /audit-logs with HR_MANAGER token | 200 + paginated data |
| POST /auth/register (generate data), then GET /audit-logs | New row appears in the list |
| GET /audit-logs?action=CREATE | Only CREATE entries |
| GET /audit-logs?entityType=USER | Only USER entity entries |
| GET /audit-logs?page=1&limit=5 | Max 5 items, `meta.totalPages` > 1 if more than 5 entries |

---

## Checklist (confirm before Step 4)

- [ ] `audit/dto/query-audit.dto.ts` created — all fields `@IsOptional()`, `@Type(() => Number)` on page/limit
- [ ] `audit/dto/index.ts` barrel export created
- [ ] `audit.service.ts` — `log()` writes one row, `findAll()` queries with filters + `Promise.all` for pagination
- [ ] `audit.interceptor.ts` — skips GET + `/auth/` routes, `tap()` for side effect, `try/catch` never crashes request
- [ ] `audit.controller.ts` — `@Roles(Role.ADMIN, Role.HR_MANAGER)` on class
- [ ] `audit.module.ts` — exports `AuditService`
- [ ] `app.module.ts` — imports `AuditModule`, registers `APP_INTERCEPTOR`
- [ ] Test: GET /audit-logs without token → 401
- [ ] Test: GET /audit-logs with VIEWER token → 403
- [ ] Test: GET /audit-logs with ADMIN token → 200 with data array
- [ ] Test: register a user → check audit-logs → CREATE/USER entry appears
- [ ] Test: `?action=CREATE` filter works
- [ ] Test: `?page=1&limit=5` pagination works — `meta` field present

---

Once confirmed, move to **Step 4: Phase 2 Final Verification** — testing all 4 roles end-to-end to confirm the full RBAC system works before moving to Phase 3.
