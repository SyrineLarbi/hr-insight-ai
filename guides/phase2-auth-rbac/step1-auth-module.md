# Phase 2 - Step 1: AuthModule — Register & Login Endpoints + JWT

## Why Are We Doing This?

Right now, anyone can call `curl http://localhost:3000` and get a response. There's no authentication — no way to know WHO is making the request. In a corporate app, this is unacceptable:

- An HR Manager should see all teams, but a Team Manager should only see theirs
- Only admins should manage user accounts
- Every action needs to be logged with WHO did it
- Reports contain sensitive salary/risk data — unauthorized access is a compliance violation

**Authentication** answers: "Who are you?" (prove your identity)
**Authorization** answers: "What can you do?" (check your permissions)

In this step, we build the authentication layer:
1. **Register** — create a new user account (hashed password, default VIEWER role)
2. **Login** — verify credentials, return a JWT token
3. **JWT Strategy** — validate the token on every subsequent request
4. **Auth Guard** — protect routes (must be logged in)

---

## How JWT Authentication Works

```
1. User sends: POST /auth/login { email, password }
2. Server verifies password against bcrypt hash in DB
3. Server creates JWT token containing { userId, email, role }
4. Server returns: { access_token: "eyJhbGciOi..." }

5. User stores token (localStorage on frontend)

6. For every subsequent request, user sends:
   GET /teams
   Authorization: Bearer eyJhbGciOi...

7. Server extracts token from header
8. Server verifies token signature (not tampered with)
9. Server decodes payload → { userId, email, role }
10. Server attaches user info to request object
11. Route handler can now access request.user
```

**What is a JWT?**
A JSON Web Token is a base64-encoded string with 3 parts separated by dots:
```
header.payload.signature

eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMiLCJyb2xlIjoiQURNSU4ifQ.abc123signature
```

- **Header**: `{ alg: "HS256" }` — the signing algorithm
- **Payload**: `{ userId: "123", role: "ADMIN", exp: 1708300800 }` — your data + expiration
- **Signature**: HMAC-SHA256(header + payload, SECRET_KEY) — proves the token wasn't modified

The server holds the `SECRET_KEY`. If anyone changes the payload (e.g., switches role from VIEWER to ADMIN), the signature won't match, and the server rejects it. This is why JWTs are secure without a database lookup on every request.

---

## The Steps

### Step A: Add JWT_SECRET to .env

Open `backend/.env` and add a JWT secret key:

```env
DATABASE_URL="postgresql://... (your existing value)"
JWT_SECRET="hr-insight-ai-super-secret-jwt-key-change-in-production-2026"
JWT_EXPIRATION="24h"
```

**What is JWT_SECRET?**
It's the private key used to sign and verify JWT tokens. Anyone who knows this secret can create valid tokens. In production, this would be a long random string stored in a vault. For development, any string works.

**What is JWT_EXPIRATION?**
How long a token stays valid. `24h` means the user stays logged in for 24 hours. After that, they need to log in again. This limits damage if a token is stolen.

### Step B: Create the Auth module structure

Create the folder structure:

```bash
mkdir -p /home/syrine/hr-insight-ai/backend/src/auth/strategies
mkdir -p /home/syrine/hr-insight-ai/backend/src/auth/guards
mkdir -p /home/syrine/hr-insight-ai/backend/src/auth/decorators
mkdir -p /home/syrine/hr-insight-ai/backend/src/auth/dto
```

**Why this structure?**
- `strategies/` — Passport.js strategies (JWT validation logic)
- `guards/` — NestJS guards (protect routes)
- `decorators/` — Custom decorators (`@Roles()`, `@CurrentUser()`)
- `dto/` — Data Transfer Objects (request body validation)

### Step C: Create the DTOs (Data Transfer Objects)

DTOs define the shape of request bodies and enforce validation. If someone sends a login request without an email, the server rejects it before it reaches your business logic.

Create `backend/src/auth/dto/register.dto.ts`:

```typescript
import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @IsString()
  @MinLength(1, { message: 'First name is required' })
  firstName: string;

  @IsString()
  @MinLength(1, { message: 'Last name is required' })
  lastName: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Role must be ADMIN, HR_MANAGER, TEAM_MANAGER, or VIEWER' })
  role?: Role;
}
```

**What each decorator does:**
- `@IsEmail()` — validates that the value is a proper email format
- `@IsString()` — validates it's a string (not a number or null)
- `@MinLength(8)` — password must be at least 8 characters
- `@IsOptional()` — role is optional (defaults to VIEWER)
- `@IsEnum(Role)` — if provided, role must be one of the valid enum values

Create `backend/src/auth/dto/login.dto.ts`:

```typescript
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  password: string;
}
```

Create `backend/src/auth/dto/index.ts` (barrel export):

```typescript
export { RegisterDto } from './register.dto.js';
export { LoginDto } from './login.dto.js';
```

**Note:** The `.js` extension in imports is required by `nodenext` module resolution. Even though the files are `.ts`, TypeScript resolves them as `.js` at runtime.

### Step D: Create the JWT Strategy

The JWT Strategy tells Passport.js HOW to validate incoming JWT tokens.

Create `backend/src/auth/strategies/jwt.strategy.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;      // userId (standard JWT claim name)
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      // Where to find the token: in the Authorization header as "Bearer <token>"
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Reject expired tokens automatically
      ignoreExpiration: false,
      // The secret key used to verify the token signature
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  // This method is called AFTER the token signature is verified
  // The payload is the decoded JWT data
  // Whatever we return here gets attached to request.user
  async validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}
```

**How this works step by step:**

1. A request comes in with `Authorization: Bearer eyJhbG...`
2. `ExtractJwt.fromAuthHeaderAsBearerToken()` pulls the token from the header
3. Passport verifies the token's signature using `JWT_SECRET`
4. If valid and not expired, Passport calls `validate()` with the decoded payload
5. `validate()` returns a user object that gets attached to `request.user`
6. Your route handler can now access `request.user.id`, `request.user.role`, etc.

### Step E: Create the Auth Guard

The Auth Guard is a NestJS guard that protects routes. If a route has `@UseGuards(JwtAuthGuard)`, only authenticated users can access it.

Create `backend/src/auth/guards/jwt-auth.guard.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

That's it — 4 lines. `AuthGuard('jwt')` tells NestJS to use the JWT strategy we defined in Step D. If the token is missing, invalid, or expired, it automatically returns 401 Unauthorized.

### Step F: Create the CurrentUser decorator

Instead of writing `request.user` everywhere, we'll create a clean decorator:

Create `backend/src/auth/decorators/current-user.decorator.ts`:

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

**How you'll use it:**
```typescript
// Without decorator:
@Get('profile')
getProfile(@Req() request: Request) {
  return request.user;  // messy, tightly coupled to Express
}

// With decorator:
@Get('profile')
getProfile(@CurrentUser() user: any) {
  return user;  // clean, decoupled
}
```

### Step G: Create the AuthService

This is the core business logic — register and login.

Create `backend/src/auth/auth.service.ts`:

```typescript
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto, LoginDto } from './dto/index.js';
import type { JwtPayload } from './strategies/jwt.strategy.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ============================
  // REGISTER
  // ============================
  async register(dto: RegisterDto) {
    // 1. Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // 2. Hash the password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 3. Create the user (default role: VIEWER unless specified)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role ?? 'VIEWER',
      },
    });

    // 4. Generate JWT token
    const token = this.generateToken(user.id, user.email, user.role);

    // 5. Return user info + token (never return passwordHash!)
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      access_token: token,
    };
  }

  // ============================
  // LOGIN
  // ============================
  async login(dto: LoginDto) {
    // 1. Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // Don't reveal whether the email exists or not (security best practice)
      throw new UnauthorizedException('Invalid email or password');
    }

    // 2. Compare password with stored hash
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // 3. Generate JWT token
    const token = this.generateToken(user.id, user.email, user.role);

    // 4. Return user info + token
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      access_token: token,
    };
  }

  // ============================
  // GET PROFILE (for authenticated user)
  // ============================
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        teamAssignments: {
          select: {
            team: {
              select: { id: true, name: true, department: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      ...user,
      // Flatten team assignments for easier frontend use
      assignedTeams: user.teamAssignments.map((ta) => ta.team),
    };
  }

  // ============================
  // HELPER: Generate JWT token
  // ============================
  private generateToken(userId: string, email: string, role: string): string {
    const payload: JwtPayload = {
      sub: userId,   // "sub" (subject) is a standard JWT claim
      email,
      role,
    };
    return this.jwtService.sign(payload);
  }
}
```

**Key security decisions explained:**

1. **"Invalid email or password"** — We use the same generic error for both wrong email and wrong password. If we said "user not found" vs "wrong password", an attacker could enumerate valid emails.

2. **bcrypt.compare()** — This is a constant-time comparison. It takes the same amount of time whether the password is wrong at the 1st character or the last. This prevents timing attacks.

3. **Never return passwordHash** — We use `select` or manually exclude the hash from responses. The frontend should never see it.

4. **`sub` claim** — Using `sub` (subject) for the user ID is a JWT standard (RFC 7519). It's not just convention — some libraries expect it.

### Step H: Create the AuthController

The controller defines the HTTP endpoints.

Create `backend/src/auth/auth.controller.ts`:

```typescript
import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto } from './dto/index.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // POST /auth/register
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /auth/login
  @Post('login')
  @HttpCode(HttpStatus.OK)  // Login returns 200, not 201 (default for POST)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // GET /auth/profile (protected — requires JWT)
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: { id: string; email: string; role: string }) {
    return this.authService.getProfile(user.id);
  }
}
```

**What each decorator does:**
- `@Controller('auth')` — All routes in this controller are prefixed with `/auth`
- `@Post('register')` → `POST /auth/register`
- `@HttpCode(HttpStatus.OK)` — Override default 201 response for POST (login should return 200)
- `@UseGuards(JwtAuthGuard)` — This route requires a valid JWT token
- `@CurrentUser()` — Extracts the authenticated user from the request
- `@Body()` — Extracts and validates the request body using the DTO

### Step I: Create the AuthModule

The module wires everything together.

Create `backend/src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION', '24h'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

**What's happening:**
- `PassportModule.register({ defaultStrategy: 'jwt' })` — Registers Passport with JWT as the default strategy
- `JwtModule.registerAsync(...)` — Configures the JWT module asynchronously (reads `.env` values via ConfigService)
- `providers: [AuthService, JwtStrategy]` — Makes both available for dependency injection
- `exports: [AuthService, JwtModule]` — Other modules can use AuthService and JWT functionality

### Step J: Register AuthModule in AppModule + enable validation

Open `backend/src/app.module.ts` and add the AuthModule:

```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

Now enable **global validation pipe** in `backend/src/main.ts` so DTOs actually validate:

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable global validation — all @Body() DTOs are validated automatically
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Strip unknown properties from request body
      forbidNonWhitelisted: true,  // Throw error if unknown properties are sent
      transform: true,       // Auto-transform types (string "5" → number 5)
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

**What the ValidationPipe options do:**
- `whitelist: true` — If someone sends `{ email, password, isAdmin: true }`, the `isAdmin` field is silently removed. Only properties defined in the DTO are allowed.
- `forbidNonWhitelisted: true` — Instead of silently removing, throw a 400 error. This is stricter and helps catch client bugs.
- `transform: true` — Automatically converts types. If a DTO expects `@IsNumber()` and the client sends `"42"` (string), it auto-converts to `42` (number).

---

## How to Verify It Worked

Start the backend (no build step needed — auto-compiles on save):

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

> **Port note:** `main.ts` uses `process.env.PORT ?? 4000` and no `PORT` is set in `.env`, so the backend runs on **port 4000**.

### How to send requests (REST Client extension)

Use the file `backend/test-requests/auth.http` — open it in VS Code and click **"Send Request"** above each block. No Postman or curl needed.

**To use the token in Test 9:**
1. Send Test 4 (admin login)
2. In the response panel, find `"access_token": "eyJ..."`
3. Copy the value — **without the surrounding quotes**
4. Paste it into `@token = ` at the top of `auth.http`
5. Send Test 9

⚠️ The `@token` variable must have **no quotes** — just the raw `eyJ...` string.

**Test 1: Register a new user**

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!","firstName":"Test","lastName":"User"}'
```

Expected response (200):
```json
{
  "user": {
    "id": "uuid-here",
    "email": "test@example.com",
    "firstName": "Test",
    "lastName": "User",
    "role": "VIEWER"
  },
  "access_token": "eyJhbGciOi..."
}
```

**Test 2: Register with duplicate email (should fail)**

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!","firstName":"Test","lastName":"User"}'
```

Expected response (409 Conflict):
```json
{
  "statusCode": 409,
  "message": "Email already registered",
  "error": "Conflict"
}
```

**Test 3: Register with invalid email (validation)**

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","password":"short","firstName":"","lastName":"User"}'
```

Expected response (400 Bad Request):
```json
{
  "statusCode": 400,
  "message": [
    "Please provide a valid email address",
    "Password must be at least 8 characters long",
    "First name is required"
  ],
  "error": "Bad Request"
}
```

**Test 4: Login with seeded admin user**

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrinsight.com","password":"Password123!"}'
```

Expected response (200):
```json
{
  "user": {
    "id": "uuid-here",
    "email": "admin@hrinsight.com",
    "firstName": "Admin",
    "lastName": "User",
    "role": "ADMIN"
  },
  "access_token": "eyJhbGciOi..."
}
```

**Test 5: Login with wrong password**

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrinsight.com","password":"WrongPassword"}'
```

Expected response (401 Unauthorized):
```json
{
  "statusCode": 401,
  "message": "Invalid email or password",
  "error": "Unauthorized"
}
```

**Test 6: Access protected route without token**

```bash
curl http://localhost:4000/auth/profile
```

Expected response (401 Unauthorized):
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

**Test 7: Access protected route WITH token**

First, copy the `access_token` from Test 4. Then:

```bash
curl http://localhost:4000/auth/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Expected response (200):
```json
{
  "id": "uuid-here",
  "email": "admin@hrinsight.com",
  "firstName": "Admin",
  "lastName": "User",
  "role": "ADMIN",
  "createdAt": "2026-02-20T...",
  "assignedTeams": []
}
```

**Test 8: Profile for team manager (should show assigned teams)**

Login as team manager first:
```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"team.manager@hrinsight.com","password":"Password123!"}'
```

Then use that token:
```bash
curl http://localhost:4000/auth/profile \
  -H "Authorization: Bearer TEAM_MANAGER_TOKEN_HERE"
```

Expected response should include `assignedTeams` with Platform Engineering.

---

## Checklist (confirm before moving to Step 2)

- [ ] `JWT_SECRET` and `JWT_EXPIRATION` added to `.env`
- [ ] Auth folder structure created (`dto/`, `strategies/`, `guards/`, `decorators/`)
- [ ] `register.dto.ts` and `login.dto.ts` with class-validator decorators
- [ ] `jwt.strategy.ts` with Passport JWT validation
- [ ] `jwt-auth.guard.ts` extending AuthGuard
- [ ] `current-user.decorator.ts` for extracting user from request
- [ ] `auth.service.ts` with register, login, getProfile methods
- [ ] `auth.controller.ts` with POST /register, POST /login, GET /profile
- [ ] `auth.module.ts` wiring everything with JwtModule + PassportModule
- [ ] `app.module.ts` imports AuthModule
- [ ] `main.ts` has ValidationPipe with whitelist + transform
- [ ] Test 1: Register works → returns user + token
- [ ] Test 4: Login works with seeded users → returns token
- [ ] Test 6: Protected route rejects unauthenticated request (401)
- [ ] Test 7: Protected route works with valid token → returns profile
- [ ] Test 8: Team manager profile shows assignedTeams

---

Once confirmed, I'll generate **Step 2: Roles Guard + @Roles() Decorator + RBAC** — where we enforce role-based access on every endpoint.
