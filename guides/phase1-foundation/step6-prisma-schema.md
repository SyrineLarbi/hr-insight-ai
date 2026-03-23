# Phase 1 - Step 6: Write Prisma Schema + Connect to Neon PostgreSQL

## Why Are We Doing This?

Every application needs a database, and every database needs a **schema** — a blueprint that defines what tables exist, what columns each table has, and how tables relate to each other.

In our project, the schema defines 8 tables that store everything the platform needs:
- Who can log in and what they can do (**users**, **team_assignments**)
- What teams and employees exist (**teams**, **employees**)
- What reports have been generated (**reports**, **action_plans**)
- What happened and when (**audit_logs**)
- How employee risk changes over time (**risk_snapshots**)

We're using **Prisma ORM** to define this schema. Instead of writing raw SQL like:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  ...
);
```

We write it in Prisma's schema language:

```prisma
model User {
  id    String @id @default(uuid())
  email String @unique
  ...
}
```

**Why is this better?**
1. **Prisma generates TypeScript types** from the schema. When you write `user.email` in your code, TypeScript knows it's a string. With raw SQL, everything is `any`.
2. **Prisma generates migrations** — SQL files that safely update the database when you change the schema, without losing data.
3. **Prisma generates a client** — `prisma.user.findMany()`, `prisma.team.create()`, etc. Full auto-completion in your IDE.
4. **One source of truth** — the schema file IS the database documentation. No separate ERD diagrams to maintain.

---

## What You Need Before Starting

You need your **Neon PostgreSQL connection string**. Here's how to get it:

1. Go to [console.neon.tech](https://console.neon.tech)
2. Select your project (or create a new one — name it "hr-insight-ai")
3. On the project dashboard, you'll see a **Connection string** section
4. Click the copy button next to the connection string
5. It looks like this:
   ```
   postgresql://username:password@ep-xxxx-xxxx-xxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

**Important**: Keep this string private. It contains your database password. Never commit it to code — we'll put it in a `.env` file that stays local.

---

## The Steps

### Step A: Initialize Prisma

```bash
cd /home/syrine/hr-insight-ai/backend
npx prisma init
```

**What this does:**
- Creates a `prisma/` folder inside `backend/`
- Creates `prisma/schema.prisma` — the file where we'll define our database structure
- Creates `prisma.config.ts` — the Prisma v7 configuration file (handles database connection)
- Creates a `.env` file in `backend/` (if one doesn't exist) with a placeholder `DATABASE_URL`

**Prisma v7 Change:** In older Prisma versions (v5/v6), the database URL was defined directly in `schema.prisma`. In Prisma v7, the connection URL moved to `prisma.config.ts`. The schema file only keeps the `provider` (postgresql). This separation is cleaner — configuration in one place, schema in another.

**Expected output:**
```
✔ Your Prisma schema was created at prisma/schema.prisma
  You can now open it in your favorite editor.
```

### Step A2: Install dotenv + Prisma v7 driver adapter

The generated `prisma.config.ts` uses `import "dotenv/config"` to load `.env` variables. Additionally, Prisma v7 requires a **driver adapter** to connect to the database (it no longer uses the built-in Rust engine for connections).

```bash
cd /home/syrine/hr-insight-ai/backend
npm install dotenv @prisma/adapter-pg
```

**Why `@prisma/adapter-pg`?**
In Prisma v5/v6, the Prisma Client connected to PostgreSQL using a built-in Rust engine. In Prisma v7, you must provide a **driver adapter** — a JavaScript-native database connection. `@prisma/adapter-pg` wraps the `pg` library for PostgreSQL. This means:
- No more Rust binary dependency
- You pass the connection string when creating the PrismaClient in your application code
- The `prisma.config.ts` still uses the URL for migrations/seeding, but the app itself uses the adapter

### Step B: Set the DATABASE_URL

Open the file `backend/.env` and replace the placeholder `DATABASE_URL` with your Neon connection string:

```env
DATABASE_URL="postgresql://username:password@ep-xxxx-xxxx-xxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

Replace the entire value with the connection string you copied from Neon. Make sure it's wrapped in double quotes.

**What is a `.env` file?**
It's a file that stores **environment variables** — configuration values that change between environments (development, staging, production). Database URLs, API keys, secrets — anything sensitive goes here.

Your app reads these values at runtime via `process.env.DATABASE_URL`. The `.env` file is never committed to version control (it's in `.gitignore` by default) because it contains secrets.

### Step C: Write the Prisma Schema

Open `backend/prisma/schema.prisma` and **replace its entire content** with the schema below.

**Read through the schema carefully** — each model (table), field (column), and relation is explained inline.

```prisma
// Prisma Schema for HR Insight AI
// This file defines the database structure. Prisma uses it to:
// 1. Generate SQL migrations (CREATE TABLE, ALTER TABLE)
// 2. Generate a TypeScript client (prisma.user.findMany(), etc.)
// 3. Provide auto-completion in your IDE

generator client {
  provider = "prisma-client-js"
  // This tells Prisma to generate a JavaScript/TypeScript client
  // that we import as: import { PrismaClient } from '@prisma/client'
}

datasource db {
  provider = "postgresql"
  // In Prisma v7, the database URL is configured in prisma.config.ts
  // (which reads DATABASE_URL from .env automatically via dotenv)
}

// ============================================================
// ENUMS — Predefined sets of allowed values
// ============================================================

// User roles for RBAC (Role-Based Access Control)
// Each role has different permissions throughout the app
enum Role {
  ADMIN        // Full access: manage users, all teams, system settings
  HR_MANAGER   // All teams, generate reports, export PDFs, view audit logs
  TEAM_MANAGER // Only assigned teams (via team_assignments), generate for own teams
  VIEWER       // Read-only: view shared reports, no generation/export
}

// Report generation status — tracks the pipeline state
enum ReportStatus {
  GENERATING // Pipeline is running (ML prediction, LLM summary, etc.)
  COMPLETED  // Successfully generated
  FAILED     // Something went wrong (API error, timeout, etc.)
}

// Risk level — categorized from the raw 0-1 score
enum RiskLevel {
  LOW    // 0.0 - 0.3: Employee is likely stable
  MEDIUM // 0.3 - 0.6: Some warning signs, worth monitoring
  HIGH   // 0.6 - 1.0: Significant flight risk, needs intervention
}

// Audit log action types — what happened
enum AuditAction {
  CREATE
  UPDATE
  DELETE
  GENERATE_REPORT
  EXPORT_PDF
  LOGIN
}

// ============================================================
// MODELS (Tables)
// ============================================================

// ---------- Users ----------
// Anyone who logs into the platform: admins, HR managers, team managers, viewers
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         Role     @default(VIEWER)
  firstName    String   @map("first_name")
  lastName     String   @map("last_name")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  // Relations — a user can:
  reports         Report[]         // Generate many reports
  auditLogs       AuditLog[]       // Have many audit log entries
  teamAssignments TeamAssignment[] // Be assigned to many teams (for TEAM_MANAGER role)

  @@map("users") // Table name in PostgreSQL will be "users" (lowercase)
}

// ---------- Teams ----------
// Departments/teams that employees belong to (e.g., "Engineering", "Marketing")
model Team {
  id         String   @id @default(uuid())
  name       String
  department String
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  // Relations
  employees       Employee[]       // A team has many employees
  reports         Report[]         // A team can have many generated reports
  teamAssignments TeamAssignment[] // Many managers can be assigned to this team

  @@map("teams")
}

// ---------- Employees ----------
// The people whose turnover risk we're predicting
// These are the core data points the ML model uses
model Employee {
  id                  String   @id @default(uuid())
  teamId              String   @map("team_id")
  name                String
  salary              Float    // Annual salary in dollars
  tenureMonths        Int      @map("tenure_months")        // How long they've been at the company
  engagementScore     Float    @map("engagement_score")     // 1-5 scale (from surveys)
  performanceScore    Float    @map("performance_score")    // 1-5 scale (from reviews)
  absenteeismDays     Int      @map("absenteeism_days")     // Days absent in last 12 months
  overtimeHours       Float    @map("overtime_hours")       // Weekly overtime hours
  lastPromotionMonths Int      @map("last_promotion_months") // Months since last promotion
  trainingHours       Float    @map("training_hours")       // Training hours completed
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  // Relations
  team          Team           @relation(fields: [teamId], references: [id], onDelete: Cascade)
  riskSnapshots RiskSnapshot[] // Historical risk scores over time

  @@map("employees")
}

// ---------- Reports ----------
// Generated insight reports — the main output of the platform
// Each report is tied to a team and a date range
model Report {
  id             String       @id @default(uuid())
  teamId         String       @map("team_id")
  generatedBy    String       @map("generated_by") // User who triggered the report
  dateRangeStart DateTime     @map("date_range_start")
  dateRangeEnd   DateTime     @map("date_range_end")
  riskScore      Float?       @map("risk_score")    // Overall team risk (0-1), null while GENERATING
  modelVersion   String?      @map("model_version") // e.g., "v1.0" — tracks which ML model was used
  summaryText    String?      @map("summary_text")  // LLM-generated executive summary (markdown)
  status         ReportStatus @default(GENERATING)
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  // Relations
  team        Team         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  generatedByUser User     @relation(fields: [generatedBy], references: [id])
  actionPlans ActionPlan[] // A report can have multiple action plan items

  @@map("reports")
}

// ---------- Action Plans ----------
// Structured action items generated by the LLM
// Stored as JSON so we can have flexible structure
model ActionPlan {
  id           String   @id @default(uuid())
  reportId     String   @map("report_id")
  planJson     Json     @map("plan_json") // Structured action plan from LLM
  projectedRoi Float?   @map("projected_roi") // Estimated ROI of implementing this plan
  createdAt    DateTime @default(now()) @map("created_at")

  // Relations
  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@map("action_plans")
}

// ---------- Audit Logs ----------
// Every significant action in the system is logged here
// This is a corporate compliance requirement — "who did what, when"
model AuditLog {
  id         String      @id @default(uuid())
  userId     String      @map("user_id")
  action     AuditAction
  entityType String      @map("entity_type") // "TEAM", "EMPLOYEE", "REPORT", etc.
  entityId   String?     @map("entity_id")   // ID of the affected entity
  metadata   Json?       // Additional context: old/new values, request details
  ipAddress  String?     @map("ip_address")
  createdAt  DateTime    @default(now()) @map("created_at")

  // Relations
  user User @relation(fields: [userId], references: [id])

  @@map("audit_logs")
}

// ---------- Risk Snapshots ----------
// Historical record of each employee's risk score over time
// Created every time a report is generated for their team
// This enables the "risk timeline" feature — see how risk evolves
model RiskSnapshot {
  id           String    @id @default(uuid())
  employeeId   String    @map("employee_id")
  riskScore    Float     @map("risk_score")    // 0-1 probability from ML model
  riskLevel    RiskLevel @map("risk_level")    // LOW / MEDIUM / HIGH
  modelVersion String    @map("model_version") // Which model version produced this score
  snapshotDate DateTime  @default(now()) @map("snapshot_date")

  // Relations
  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@map("risk_snapshots")
}

// ---------- Team Assignments ----------
// Maps which TEAM_MANAGER users can access which teams
// This is the core of granular RBAC — without this, we'd need separate roles per team
// A TEAM_MANAGER can be assigned to 1 or more teams
// A team can have 1 or more assigned managers
// This is a many-to-many join table
model TeamAssignment {
  id     String @id @default(uuid())
  userId String @map("user_id")
  teamId String @map("team_id")

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)

  // Ensure a user can't be assigned to the same team twice
  @@unique([userId, teamId])
  @@map("team_assignments")
}
```

---

## Understanding the Schema — Key Concepts

### @id @default(uuid())

Every row needs a unique identifier. We use **UUIDs** (Universally Unique Identifiers) instead of auto-incrementing integers (1, 2, 3...).

Why UUIDs?
- **Security**: Sequential IDs expose information. If a user sees `/employees/42`, they know there are at least 42 employees and can try `/employees/1` through `/employees/41`. UUIDs like `f47ac10b-58cc-4372-a567-0e02b2c3d479` reveal nothing.
- **Distributed systems**: If you ever have multiple servers writing to the database, integer IDs can collide. UUIDs are globally unique — two servers will never generate the same one.
- **Industry standard**: Every enterprise app uses UUIDs. It's expected.

### @map("column_name")

Prisma uses camelCase in TypeScript (`passwordHash`, `firstName`) but databases conventionally use snake_case (`password_hash`, `first_name`). The `@map` directive tells Prisma: "In my TypeScript code, call this `passwordHash`, but in the database, the column is `password_hash`."

Similarly, `@@map("users")` tells Prisma: "In my code, this model is `User` (PascalCase), but the database table is `users` (lowercase plural)."

This is a best practice — you get idiomatic naming in both worlds.

### Relations and Foreign Keys

```prisma
model Employee {
  teamId String @map("team_id")
  team   Team   @relation(fields: [teamId], references: [id], onDelete: Cascade)
}
```

This defines a **foreign key relationship**:
- `teamId` stores the UUID of the team this employee belongs to
- `team Team @relation(...)` tells Prisma how to join the tables
- `fields: [teamId]` = "the column in THIS table that holds the reference"
- `references: [id]` = "the column in the OTHER table it points to"
- `onDelete: Cascade` = "if the team is deleted, delete all its employees too"

**What is `onDelete: Cascade`?**
When a parent record is deleted, what should happen to its children?
- `Cascade`: Delete children too (delete team → delete all its employees)
- `SetNull`: Set the foreign key to null (employee still exists, but has no team)
- `Restrict`: Prevent deletion (can't delete a team that has employees)

We use `Cascade` for tight relationships (team→employees, report→action_plans) and no cascade for loose ones (user→audit_logs — don't delete audit history if user is removed).

### @@unique([userId, teamId])

This is a **composite unique constraint**. It tells the database: "The combination of userId AND teamId must be unique." A manager can be assigned to team A and team B, but they can't be assigned to team A twice. The database enforces this automatically — no application code needed.

### Json Type

```prisma
planJson Json @map("plan_json")
metadata Json?
```

The `Json` type stores arbitrary JSON data. This is useful when the structure is flexible:
- `planJson` stores the LLM-generated action plan (which may have varying fields)
- `metadata` in audit logs stores context like `{ "oldValue": {...}, "newValue": {...} }`

PostgreSQL has native JSON support (the `jsonb` type) which allows querying inside JSON fields if needed.

### Optional Fields (?)

```prisma
riskScore    Float?    // null while report is GENERATING
summaryText  String?   // null until LLM generates it
ipAddress    String?   // might not always be available
```

The `?` makes a field optional (nullable). This is important for fields that aren't available immediately — like `riskScore` which is null while the report is still generating.

---

## Entity Relationship Diagram

Here's how the 8 tables relate to each other:

```
┌──────────────────┐
│      User        │
│  (id, email,     │
│   role, ...)     │
├──────────────────┤
│ has many         │──→ Report (generatedBy → user.id)
│ has many         │──→ AuditLog (userId → user.id)
│ has many         │──→ TeamAssignment (userId → user.id)
└──────────────────┘

┌──────────────────┐
│      Team        │
│  (id, name,      │
│   department)    │
├──────────────────┤
│ has many         │──→ Employee (teamId → team.id)
│ has many         │──→ Report (teamId → team.id)
│ has many         │──→ TeamAssignment (teamId → team.id)
└──────────────────┘

┌──────────────────┐        ┌──────────────────┐
│    Employee      │        │  RiskSnapshot    │
│ (salary, tenure, │        │ (riskScore,      │
│  engagement...)  │───────→│  riskLevel,      │
│                  │has many│  snapshotDate)   │
└──────────────────┘        └──────────────────┘

┌──────────────────┐        ┌──────────────────┐
│    Report        │        │   ActionPlan     │
│ (riskScore,      │        │ (planJson,       │
│  summaryText,    │───────→│  projectedRoi)   │
│  status)         │has many│                  │
└──────────────────┘        └──────────────────┘

┌──────────────────┐        ┌──────────────────┐
│   AuditLog       │        │ TeamAssignment   │
│ (action, entity, │        │ (userId, teamId) │
│  metadata, ip)   │        │ many-to-many     │
└──────────────────┘        └──────────────────┘
```

### Table Count Summary

| Table | Purpose | Rows (estimated after seed) |
|-------|---------|----------------------------|
| users | Platform users (login accounts) | 4 (1 per role) |
| teams | Departments/teams | 3 |
| employees | Team members with HR metrics | 50-75 (15-25 per team) |
| reports | Generated insight reports | 0 (created via UI) |
| action_plans | LLM-generated action items | 0 (created with reports) |
| audit_logs | Activity tracking | 0 (auto-populated) |
| risk_snapshots | Employee risk history | 0 (created with reports) |
| team_assignments | Manager ↔ Team mapping | 2-3 |

---

## Step D: Run the Migration

After saving the schema, run the migration to create the tables in Neon:
npm install dotenv

```bash
cd /home/syrine/hr-insight-ai/backend
npx prisma migrate dev --name init
```

**What this command does (step by step):**

1. **Reads** `schema.prisma` and compares it to the current database state (empty)
2. **Generates** a SQL migration file in `prisma/migrations/YYYYMMDDHHMMSS_init/migration.sql`
3. **Executes** the SQL against your Neon database (creates all 8 tables, enums, indexes, foreign keys)
4. **Generates** the Prisma Client (TypeScript types and query methods)

**Expected output:**
```
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-xxxx.us-east-2.aws.neon.tech:5432"

Applying migration `20260217XXXXXX_init`

The following migration(s) have been created and applied from new schema changes:

migrations/
  └─ 20260217XXXXXX_init/
    └─ migration.sql

Your database is now in sync with your schema.

✔ Generated Prisma Client ...
```

**If you get a connection error:**
- Double-check your `DATABASE_URL` in `.env`
- Make sure the Neon project is active (free tier pauses after 5 minutes of inactivity — just open the Neon dashboard to wake it up)
- The connection string must end with `?sslmode=require`

### Step E: View the Generated Migration

After the migration runs, Prisma created a SQL file. Let's look at it to understand what happened:

```bash
ls /home/syrine/hr-insight-ai/backend/prisma/migrations/
```

You'll see a folder like `20260217123456_init/`. Inside is `migration.sql` — the raw SQL that Prisma executed. This is the exact SQL that created your tables in Neon. You can open it to see the `CREATE TYPE`, `CREATE TABLE`, `ALTER TABLE` statements.

### Step F: Verify Tables in Neon

You can verify the tables were created in two ways:

**Option 1: Using Prisma Studio (recommended)**

```bash
cd /home/syrine/hr-insight-ai/backend
npx prisma studio
```

This opens a browser-based database viewer at `http://localhost:5555`. You'll see all 8 tables listed. Click on any table to see its columns. The tables will be empty — we'll fill them with seed data in the next step.

**Option 2: Using the Neon dashboard**

Go to [console.neon.tech](https://console.neon.tech) → your project → **SQL Editor** tab. Run:

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
```

You should see: `users`, `teams`, `employees`, `reports`, `action_plans`, `audit_logs`, `risk_snapshots`, `team_assignments`, `_prisma_migrations`.

(The `_prisma_migrations` table is created by Prisma to track which migrations have been applied.)

---

## Step G: Create PrismaService (NestJS Integration)

Prisma Client needs to be available throughout the NestJS application. The standard pattern is to create a **PrismaService** that wraps the client and manages the database connection lifecycle.

Create the folder and file:

```bash
mkdir -p /home/syrine/hr-insight-ai/backend/src/prisma
```

Then create the file `backend/src/prisma/prisma.service.ts` with this content:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

**Prisma v7 Change:** In older versions, `new PrismaClient()` worked with no arguments because the URL was in `schema.prisma`. In Prisma v7, you must pass a driver adapter to the constructor. The `PrismaPg` adapter reads the connection string from `.env` and establishes the PostgreSQL connection.

**What each part does:**

- `@Injectable()` — Makes this class available for NestJS dependency injection. Any service or controller can request a `PrismaService` instance and NestJS will provide one.
- `extends PrismaClient` — This service IS a Prisma Client. It inherits all methods: `this.user.findMany()`, `this.team.create()`, etc.
- `OnModuleInit` — When the NestJS app starts, `onModuleInit()` runs and connects to the database.
- `OnModuleDestroy` — When the app shuts down, `onModuleDestroy()` runs and cleanly disconnects. This prevents connection leaks.

**Why not just use `new PrismaClient()` everywhere?**
- **Single connection**: You want ONE database connection pool, not a new one in every file.
- **Lifecycle management**: NestJS manages when to connect/disconnect. With `new PrismaClient()`, you'd have to manage this yourself.
- **Testability**: In tests, you can mock `PrismaService` to avoid hitting the real database.

Now create the file `backend/src/prisma/prisma.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**What each part does:**

- `@Global()` — Makes this module available everywhere in the app without importing it in every other module. Since every module needs database access, this saves a lot of boilerplate.
- `providers: [PrismaService]` — Registers the service so NestJS can create instances of it.
- `exports: [PrismaService]` — Allows other modules to inject `PrismaService`. Without this, it would be private to this module.

### Step H: Register PrismaModule in AppModule

Open `backend/src/app.module.ts` and add the PrismaModule import:

```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**What changed:**
- Added `import { PrismaModule } from './prisma/prisma.module';`
- Added `PrismaModule` to the `imports` array

Now every module in the app can inject `PrismaService` and query the database.

### Step I: Add ConfigModule for .env loading

We also need to set up `@nestjs/config` so NestJS loads the `.env` file. Update `app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**What `ConfigModule.forRoot({ isGlobal: true })` does:**
- Loads the `.env` file at startup
- Makes `ConfigService` available globally (any service can inject it to read env variables)
- `isGlobal: true` means you don't need to import `ConfigModule` in every module

### Step J: Exclude prisma folder from TypeScript build

The `prisma/` folder contains `seed.ts` (created in Step 7) which uses `tsx` to run directly — it should NOT be compiled by the NestJS build. If it's included, the build will fail with type errors because `nodenext` module resolution doesn't fully resolve Prisma's generated types.

Open `backend/tsconfig.build.json` and add `"prisma"` to the exclude array:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "prisma", "**/*spec.ts"]
}
```

Also update `backend/tsconfig.json` to add an exclude section:

```json
{
  "compilerOptions": {
    ...
  },
  "exclude": ["prisma", "dist"]
}
```

**Why?** The `prisma/seed.ts` file is run by `tsx` (which skips type checking). Including it in the NestJS TypeScript compilation would cause errors because `nodenext` module resolution struggles with Prisma v7's re-export chain (`@prisma/client` → `.prisma/client/default` → `.prisma/client/index`). Excluding it is the clean solution — the seed runs perfectly via `tsx`, and the NestJS app compiles without issues.

### Step K: Generate the Prisma Client

After migration, explicitly generate the Prisma Client to ensure the TypeScript types and query methods are available:

```bash
cd /home/syrine/hr-insight-ai/backend
npx prisma generate
```

This creates the `.prisma/client/` folder inside `node_modules/` with all generated types and the query engine.

---

## How to Verify It Worked

**Step 1: Migration ran successfully**

```bash
cd /home/syrine/hr-insight-ai/backend
npx prisma migrate status
```

Expected output should show your migration as "applied".

**Step 2: Prisma Studio shows tables**

```bash
npx prisma studio
```

Open `http://localhost:5555` in your browser. You should see all 8 tables listed (all empty).

**Step 3: Backend still starts**

```bash
npm run start:dev
```

The backend should start and show "Nest application successfully started". If it connects to Neon successfully, there will be no database errors in the console.

**Step 4: Stop both** — Prisma Studio (`Ctrl+C`) and the backend (`Ctrl+C`).

---

## Checklist (confirm before moving to Step 7)

- [ ] `npx prisma init` created `prisma/schema.prisma`, `prisma.config.ts`, and `.env`
- [ ] `npm install dotenv @prisma/adapter-pg` installed
- [ ] `DATABASE_URL` in `.env` points to your Neon PostgreSQL
- [ ] `schema.prisma` datasource block has `provider` only (NO `url` — that's in `prisma.config.ts`)
- [ ] `schema.prisma` contains all 8 models (User, Team, Employee, Report, ActionPlan, AuditLog, RiskSnapshot, TeamAssignment)
- [ ] `npx prisma migrate dev --name init` ran successfully
- [ ] `npx prisma generate` ran successfully
- [ ] Migration SQL file exists in `prisma/migrations/`
- [ ] Prisma Studio (`npx prisma studio`) shows all 8 tables at localhost:5555
- [ ] `src/prisma/prisma.service.ts` created with `PrismaPg` adapter in constructor
- [ ] `src/prisma/prisma.module.ts` created with @Global() decorator
- [ ] `app.module.ts` imports both `ConfigModule` and `PrismaModule`
- [ ] `tsconfig.build.json` excludes `"prisma"` folder
- [ ] `tsconfig.json` excludes `["prisma", "dist"]`
- [ ] `npm run build` passes with 0 errors
- [ ] `npm run start:dev` starts without errors

---

Once confirmed, I'll generate **Step 7: Write Seed Script** — we'll populate the database with 3 teams, 50-75 realistic employees, an admin user, and team assignments so you have real data to work with.
