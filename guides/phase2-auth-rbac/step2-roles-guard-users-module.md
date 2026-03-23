# Phase 2 - Step 2: Roles Guard + @Roles() Decorator + UsersModule

## Why Are We Doing This?

Step 1 answered "Are you logged in?" — now Step 2 answers "What are you allowed to do?"

Right now, any authenticated user (VIEWER, TEAM_MANAGER, HR_MANAGER, ADMIN) can call any endpoint. We need to enforce role-based access:

- Only **ADMIN** can manage users and change roles
- Only **ADMIN** can assign teams to managers
- **TEAM_MANAGER** can only see their assigned teams (enforced in Phase 3)
- **VIEWER** can only read — no writes, no generation

We also fix a design problem: currently, every route must manually add `@UseGuards(JwtAuthGuard)` to be protected. That's error-prone — if a developer forgets, sensitive data is exposed. We'll flip the default: **all routes are protected by default**, and only explicitly marked routes are public.

---

## What We're Building

```
src/auth/
  decorators/
    public.decorator.ts      ← @Public() — marks a route as no-auth-needed
    roles.decorator.ts       ← @Roles('ADMIN', 'HR_MANAGER') — marks required roles
  guards/
    jwt-auth.guard.ts        ← MODIFIED: now global + respects @Public()
    roles.guard.ts           ← NEW: checks user.role against @Roles() metadata

src/users/
  dto/
    update-role.dto.ts       ← { role: Role }
    assign-teams.dto.ts      ← { teamIds: string[] }
    index.ts                 ← barrel export
  users.service.ts           ← DB queries (list, get, update role, assign teams)
  users.controller.ts        ← HTTP routes (all ADMIN-only)
  users.module.ts            ← wires everything

src/app.module.ts            ← MODIFIED: register both guards globally + import UsersModule
src/auth/auth.controller.ts  ← MODIFIED: add @Public() to register + login
```

---

## How RBAC Works in NestJS

```
Request → JwtAuthGuard → RolesGuard → Route Handler
              │                │
              │                └── reads @Roles() metadata
              │                    if no @Roles() → allow (any authenticated user)
              │                    if has @Roles() → check request.user.role
              │
              └── reads @Public() metadata
                  if @Public() → skip JWT check entirely
                  if not @Public() → validate JWT token
```

Registering guards with `APP_GUARD` makes them run on **every route** automatically. No need to add `@UseGuards()` to individual controllers — you only need decorators to customize behavior (`@Public()`, `@Roles()`).

---

## The Steps

### Step A: Create the @Public() decorator

When a guard is global, you need a way to say "this route is an exception — no auth needed." `@Public()` does that by setting metadata that the `JwtAuthGuard` reads.

Create `backend/src/auth/decorators/public.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Usage: @Public() on any route to bypass JWT authentication
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

**How it works:**
`SetMetadata` attaches a key-value pair to the route handler's metadata. The `JwtAuthGuard` will check if `isPublic: true` is present and, if so, skip token validation.

---

### Step B: Create the @Roles() decorator

Create `backend/src/auth/decorators/roles.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Usage: @Roles(Role.ADMIN) or @Roles(Role.ADMIN, Role.HR_MANAGER)
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

**Usage example (preview — you'll write this in the controller):**
```typescript
@Get()
@Roles(Role.ADMIN)
findAll() { ... }  // only ADMIN can call this

@Get(':id')
@Roles(Role.ADMIN, Role.HR_MANAGER)
findOne() { ... }  // ADMIN or HR_MANAGER

@Get('profile')
getProfile() { ... }  // no @Roles → any authenticated user
```

---

### Step C: Update JwtAuthGuard to be global-aware

The current `JwtAuthGuard` doesn't know about `@Public()`. We need to add `Reflector` (NestJS's metadata reader) so it can check if a route is marked public.

Replace `backend/src/auth/guards/jwt-auth.guard.ts`:

```typescript
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if the route is decorated with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),  // method-level decorator first
      context.getClass(),    // class-level decorator as fallback
    ]);

    // If @Public(), skip JWT validation entirely
    if (isPublic) return true;

    // Otherwise, run the standard JWT validation
    return super.canActivate(context);
  }
}
```

**Why `getAllAndOverride`?**
NestJS checks the decorator on the specific method first (e.g., `@Get('login')`), then the class (e.g., `@Controller('auth')`). The method-level decorator wins. This lets you mark an entire controller as public with `@Public()` on the class, then override individual methods.

---

### Step D: Create the RolesGuard

Create `backend/src/auth/guards/roles.guard.ts`:

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Read the @Roles() metadata from the route
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator → allow any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) return true;

    // Get the user object set by JwtAuthGuard (from jwt.strategy.ts validate())
    const { user } = context.switchToHttp().getRequest();

    // Check if user's role is in the list of required roles
    return requiredRoles.includes(user?.role);
  }
}
```

**Important:** `RolesGuard` runs AFTER `JwtAuthGuard`. This means `request.user` is already populated when `RolesGuard` checks it. The order guards run in `APP_GUARD` registration matters — JWT first, then Roles.

---

### Step E: Register both guards globally in AppModule

Update `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Register JWT guard globally — protects ALL routes by default
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Register Roles guard globally — enforces @Roles() on every route
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

**Why this is better than `@UseGuards()` per controller:**
If you forget to add `@UseGuards()` to a new controller, it's unprotected. With `APP_GUARD`, every new controller is protected automatically — you must explicitly opt out with `@Public()`. Security-by-default.

---

### Step F: Add @Public() to auth endpoints

Now that JWT is global, register and login would require a token — which is circular (you need to log in to get a token, but you need a token to log in). Add `@Public()` to those routes.

Update `backend/src/auth/auth.controller.ts`:

```typescript
import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto } from './dto/index.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // POST /auth/register — public (no token needed)
  @Post('register')
  @Public()
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /auth/login — public (no token needed)
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // GET /auth/profile — protected (JWT global guard handles this now)
  // No @UseGuards(JwtAuthGuard) needed — it's registered globally
  @Get('profile')
  async getProfile(@CurrentUser() user: { id: string; email: string; role: string }) {
    return this.authService.getProfile(user.id);
  }
}
```

Note: `@UseGuards(JwtAuthGuard)` is removed from `getProfile` — the global guard already handles it. The import for `JwtAuthGuard` is also removed (no longer needed here), but keep it for now since it's imported — TypeScript won't complain about unused imports in this context.

Actually, remove the `JwtAuthGuard` import since it's no longer used in the controller:

```typescript
import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto } from './dto/index.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
```

---

### Step G: Create the UsersModule DTOs

Create `backend/src/users/dto/update-role.dto.ts`:

```typescript
import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateRoleDto {
  @IsEnum(Role, { message: 'Role must be ADMIN, HR_MANAGER, TEAM_MANAGER, or VIEWER' })
  role: Role;
}
```

Create `backend/src/users/dto/assign-teams.dto.ts`:

```typescript
import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class AssignTeamsDto {
  @IsArray({ message: 'teamIds must be an array' })
  @ArrayMinSize(0)
  @IsUUID('4', { each: true, message: 'Each teamId must be a valid UUID' })
  teamIds: string[];
}
```

Create `backend/src/users/dto/index.ts`:

```typescript
export { UpdateRoleDto } from './update-role.dto.js';
export { AssignTeamsDto } from './assign-teams.dto.js';
```

---

### Step H: Create UsersService

Create `backend/src/users/users.service.ts`:

```typescript
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateRoleDto, AssignTeamsDto } from './dto/index.js';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ============================
  // LIST ALL USERS (ADMIN only)
  // ============================
  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        teamAssignments: {
          select: {
            team: { select: { id: true, name: true, department: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ============================
  // GET ONE USER (ADMIN only)
  // ============================
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        teamAssignments: {
          select: {
            team: { select: { id: true, name: true, department: true } },
          },
        },
      },
    });

    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    return user;
  }

  // ============================
  // UPDATE USER ROLE (ADMIN only)
  // ============================
  async updateRole(id: string, dto: UpdateRoleDto) {
    // Verify user exists first
    await this.findOne(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: dto.role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    return updated;
  }

  // ============================
  // ASSIGN TEAMS TO USER (ADMIN only)
  // Used for TEAM_MANAGER role — gives access to specific teams
  // ============================
  async assignTeams(userId: string, dto: AssignTeamsDto) {
    // Verify user exists
    await this.findOne(userId);

    // Verify all teamIds exist
    const teams = await this.prisma.team.findMany({
      where: { id: { in: dto.teamIds } },
      select: { id: true },
    });

    if (teams.length !== dto.teamIds.length) {
      const foundIds = teams.map((t) => t.id);
      const missing = dto.teamIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(`Teams not found: ${missing.join(', ')}`);
    }

    // Replace all existing team assignments (atomic: delete old + create new)
    await this.prisma.$transaction([
      this.prisma.teamAssignment.deleteMany({ where: { userId } }),
      this.prisma.teamAssignment.createMany({
        data: dto.teamIds.map((teamId) => ({ userId, teamId })),
      }),
    ]);

    // Return updated user with new assignments
    return this.findOne(userId);
  }

  // ============================
  // DELETE USER (ADMIN only)
  // ============================
  async remove(id: string) {
    await this.findOne(id); // throws 404 if not found
    await this.prisma.user.delete({ where: { id } });
    return { message: `User ${id} deleted successfully` };
  }
}
```

**Key decisions:**
- `select` on every query — we never accidentally return `passwordHash`
- `assignTeams` uses a Prisma **transaction** — if creating new assignments fails, the delete is rolled back. Data stays consistent.
- `$transaction([array])` is the "sequential transaction" pattern — all operations succeed or all fail together.

---

### Step I: Create UsersController

Create `backend/src/users/users.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service.js';
import { UpdateRoleDto, AssignTeamsDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

// All routes in this controller require ADMIN role
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private usersService: UsersService) {}

  // GET /users — list all users
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // GET /users/:id — get one user by UUID
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  // PATCH /users/:id/role — change a user's role
  @Patch(':id/role')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(id, dto);
  }

  // POST /users/:id/assign-teams — assign teams to a TEAM_MANAGER
  @Post(':id/assign-teams')
  assignTeams(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTeamsDto,
  ) {
    return this.usersService.assignTeams(id, dto);
  }

  // DELETE /users/:id — remove a user
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
```

**What `ParseUUIDPipe` does:**
NestJS automatically validates that the `:id` path param is a valid UUID format. If someone calls `GET /users/not-a-uuid`, NestJS returns a 400 before your code even runs. No manual UUID validation needed.

**`@Roles(Role.ADMIN)` on the class:**
This applies to all routes in the controller. Any method that needs a different role can override it with its own `@Roles()` decorator.

---

### Step J: Create UsersModule

Create `backend/src/users/users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

**Why `exports: [UsersService]`?**
Other modules (e.g., `AuthModule` for profile lookups) may need `UsersService` in future steps. Exporting it now means they can import `UsersModule` and inject `UsersService` without duplication.

---

## How to Verify It Worked

Start the backend:

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

Use `backend/test-requests/users.http` — open in VS Code and click "Send Request" on each block.

### What to test:

| Test | Expected |
|------|----------|
| Users list without token | 401 Unauthorized |
| Users list with VIEWER token | 403 Forbidden |
| Users list with ADMIN token | 200 — array of users |
| Update role with ADMIN token | 200 — updated user |
| Assign teams with ADMIN token | 200 — user with teamAssignments |
| Profile route (no `@UseGuards`) | still 200 with token — global guard works |

---

## Checklist (confirm before moving to Step 3)

- [ ] `public.decorator.ts` created (`IS_PUBLIC_KEY`, `@Public()`)
- [ ] `roles.decorator.ts` created (`ROLES_KEY`, `@Roles()`)
- [ ] `jwt-auth.guard.ts` updated (Reflector injection + `@Public()` check)
- [ ] `roles.guard.ts` created (reads `@Roles()` metadata, checks `user.role`)
- [ ] `app.module.ts` updated (APP_GUARD for both guards + UsersModule import)
- [ ] `auth.controller.ts` updated (`@Public()` on register + login, removed manual `@UseGuards`)
- [ ] `users/dto/` created (update-role, assign-teams, index)
- [ ] `users.service.ts` created (findAll, findOne, updateRole, assignTeams, remove)
- [ ] `users.controller.ts` created (`@Roles(Role.ADMIN)` on class)
- [ ] `users.module.ts` created
- [ ] Test: GET /users without token → 401
- [ ] Test: GET /users with VIEWER token → 403
- [ ] Test: GET /users with ADMIN token → 200 array
- [ ] Test: PATCH /users/:id/role → role changed
- [ ] Test: POST /users/:id/assign-teams → team assignments updated
- [ ] Test: GET /auth/profile still works (global guard, no manual `@UseGuards`)

---

