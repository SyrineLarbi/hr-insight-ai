# Phase 1 - Step 7: Write and Run the Seed Script

## Why Are We Doing This?

An empty database is useless for development. You can't test your dashboard, API endpoints, or ML predictions without data. **Seeding** means populating the database with realistic sample data so you can:

1. **Develop the frontend** — see actual teams, employees, and metrics in the UI
2. **Test RBAC** — log in as different roles (ADMIN, HR_MANAGER, TEAM_MANAGER, VIEWER) and verify access
3. **Test the ML pipeline** — run predictions on employees with varied metrics
4. **Verify relationships** — confirm foreign keys work (employees belong to teams, team assignments link managers to teams)

Our seed script creates:
- **4 users** (1 per role) — all with the password `Password123!`
- **3 teams** — Engineering, Marketing, Sales (different departments)
- **60 employees** — 20 per team with realistic, varied HR metrics
- **2 team assignments** — the TEAM_MANAGER user is assigned to 1 team (so we can test scoped access)

The employee data is carefully designed with realistic distributions:
- Mix of high/low engagement, high/low performance
- Varied salaries (by department), tenure, overtime
- Some employees with "red flag" patterns (high overtime + low engagement + no promotion = high turnover risk)
- Some employees with "stable" patterns (high engagement + recent promotion + training = low risk)

This gives the ML model meaningful patterns to learn from.

---

## The Steps

### Step A: Install tsx (TypeScript executor)

We need a way to run TypeScript files directly (without compiling first). `tsx` is the standard tool for this:

```bash
cd /home/syrine/hr-insight-ai/backend
npm install -D tsx
```

**Why tsx?**
The seed file is TypeScript (`.ts`). Node.js can't run TypeScript directly — it only understands JavaScript. `tsx` acts as a bridge: it compiles and runs TypeScript in one step. It's much faster than `ts-node` and handles modern TypeScript features (like `nodenext` module resolution) without issues.

### Step B: Configure the seed command

We need to tell Prisma how to run our seed file. In Prisma v7, this is configured in `prisma.config.ts`.

Open `backend/prisma.config.ts` and update it to:

```typescript
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
```

**What changed:** We added `seed` as a string inside the `migrations` section. This tells Prisma: "When someone runs `npx prisma db seed`, execute `npx tsx prisma/seed.ts`."

**Prisma v7 Note:** The `seed` property must be:
- **Inside `migrations`** (not at the top level of the config)
- **A plain string** (not an object like `{ command: "..." }`) — just the command directly

### Step C: Create the seed file

Create the file `backend/prisma/seed.ts` with the content below.

**Read through it carefully** — every section is explained with comments.

```typescript
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ============================================================
// Helper: Hash a password with bcrypt
// ============================================================
async function hashPassword(password: string): Promise<string> {
  // bcrypt.hash(password, saltRounds)
  // Salt rounds = 10 means bcrypt generates a random salt and runs
  // the hashing algorithm 2^10 = 1024 times. This makes brute-force
  // attacks extremely slow. 10 is the standard for production apps.
  return bcrypt.hash(password, 10);
}

// ============================================================
// Helper: Generate a random number between min and max
// ============================================================
function rand(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// Helper: Pick a random item from an array
// ============================================================
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================
// Employee name pools (for realistic data)
// ============================================================
const firstNames = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael",
  "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan",
  "Joseph", "Jessica", "Thomas", "Sarah", "Christopher", "Karen",
  "Daniel", "Lisa", "Matthew", "Nancy", "Anthony", "Betty", "Mark",
  "Margaret", "Donald", "Sandra", "Steven", "Ashley", "Andrew", "Dorothy",
  "Paul", "Kimberly", "Joshua", "Emily", "Kenneth", "Donna",
  "Kevin", "Michelle", "Brian", "Carol", "George", "Amanda",
  "Timothy", "Melissa", "Ronald", "Deborah", "Jason", "Stephanie",
  "Edward", "Rebecca", "Ryan", "Sharon", "Jacob", "Laura",
  "Gary", "Cynthia", "Nicholas", "Kathleen",
];

const lastNames = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
  "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
  "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera",
  "Campbell", "Mitchell", "Carter", "Roberts",
];

// ============================================================
// Team configurations — different salary ranges per department
// ============================================================
interface TeamConfig {
  name: string;
  department: string;
  salaryRange: [number, number];
  overtimeRange: [number, number];
}

const teamConfigs: TeamConfig[] = [
  {
    name: "Platform Engineering",
    department: "Engineering",
    salaryRange: [75000, 145000],  // Engineers earn more
    overtimeRange: [0, 20],        // Moderate overtime
  },
  {
    name: "Growth Marketing",
    department: "Marketing",
    salaryRange: [55000, 105000],
    overtimeRange: [0, 15],        // Less overtime
  },
  {
    name: "Enterprise Sales",
    department: "Sales",
    salaryRange: [50000, 120000],  // Wide range (base + commission potential)
    overtimeRange: [0, 25],        // Sales can be high-overtime
  },
];

// ============================================================
// Generate employees with realistic, varied HR metrics
// ============================================================
function generateEmployees(teamId: string, config: TeamConfig, count: number) {
  const employees = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    // Generate unique name
    let name: string;
    do {
      name = `${pick(firstNames)} ${pick(lastNames)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    // Tenure: 1-120 months (1 month to 10 years)
    const tenureMonths = randInt(1, 120);

    // Engagement score: 1.0 - 5.0
    // Create a mix: most employees are 2.5-4.5, some extremes
    const engagementScore = Math.min(5, Math.max(1, rand(1.5, 5.0)));

    // Performance score: 1.0 - 5.0
    // Slightly correlated with engagement (but not perfectly)
    const basePerformance = engagementScore + rand(-1.5, 1.5);
    const performanceScore = Math.min(5, Math.max(1, Math.round(basePerformance * 100) / 100));

    // Salary: based on department range, slightly higher for longer tenure
    const tenureBonus = tenureMonths * rand(50, 200);
    const salary = Math.round(rand(config.salaryRange[0], config.salaryRange[1]) + tenureBonus);

    // Absenteeism: 0-30 days/year
    // Inverse correlation with engagement (disengaged = more absent)
    const baseAbsenteeism = Math.round((5 - engagementScore) * rand(1, 4));
    const absenteeismDays = Math.min(30, Math.max(0, baseAbsenteeism + randInt(-2, 3)));

    // Overtime: department-based range
    const overtimeHours = rand(config.overtimeRange[0], config.overtimeRange[1]);

    // Last promotion: months since last promotion
    // Can't be more than tenure, and longer gaps = higher risk signal
    const lastPromotionMonths = randInt(1, Math.max(1, tenureMonths));

    // Training hours: 0-100
    // Companies that invest in training have lower turnover
    const trainingHours = rand(0, 80);

    employees.push({
      teamId,
      name,
      salary,
      tenureMonths,
      engagementScore: Math.round(engagementScore * 100) / 100,
      performanceScore: Math.round(performanceScore * 100) / 100,
      absenteeismDays,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      lastPromotionMonths,
      trainingHours: Math.round(trainingHours * 100) / 100,
    });
  }

  return employees;
}

// ============================================================
// Main seed function
// ============================================================
async function main() {
  console.log("🌱 Starting seed...\n");

  // ----------------------------------------------------------
  // Step 1: Clean existing data (in correct order for foreign keys)
  // ----------------------------------------------------------
  // We delete in reverse order of dependencies:
  // risk_snapshots → action_plans → audit_logs → reports → employees
  // → team_assignments → teams → users
  console.log("🧹 Cleaning existing data...");
  await prisma.riskSnapshot.deleteMany();
  await prisma.actionPlan.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.report.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.teamAssignment.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();
  console.log("   ✓ All tables cleared\n");

  // ----------------------------------------------------------
  // Step 2: Create users (1 per role)
  // ----------------------------------------------------------
  console.log("👤 Creating users...");
  const passwordHash = await hashPassword("Password123!");

  const admin = await prisma.user.create({
    data: {
      email: "admin@hrinsight.com",
      passwordHash,
      role: Role.ADMIN,
      firstName: "Admin",
      lastName: "User",
    },
  });
  console.log(`   ✓ ADMIN: ${admin.email}`);

  const hrManager = await prisma.user.create({
    data: {
      email: "hr.manager@hrinsight.com",
      passwordHash,
      role: Role.HR_MANAGER,
      firstName: "Sarah",
      lastName: "Johnson",
    },
  });
  console.log(`   ✓ HR_MANAGER: ${hrManager.email}`);

  const teamManager = await prisma.user.create({
    data: {
      email: "team.manager@hrinsight.com",
      passwordHash,
      role: Role.TEAM_MANAGER,
      firstName: "Michael",
      lastName: "Chen",
    },
  });
  console.log(`   ✓ TEAM_MANAGER: ${teamManager.email}`);

  const viewer = await prisma.user.create({
    data: {
      email: "viewer@hrinsight.com",
      passwordHash,
      role: Role.VIEWER,
      firstName: "Emily",
      lastName: "Davis",
    },
  });
  console.log(`   ✓ VIEWER: ${viewer.email}\n`);

  // ----------------------------------------------------------
  // Step 3: Create teams
  // ----------------------------------------------------------
  console.log("🏢 Creating teams...");
  const teams = [];

  for (const config of teamConfigs) {
    const team = await prisma.team.create({
      data: {
        name: config.name,
        department: config.department,
      },
    });
    teams.push({ team, config });
    console.log(`   ✓ ${team.name} (${team.department})`);
  }
  console.log();

  // ----------------------------------------------------------
  // Step 4: Create employees (20 per team = 60 total)
  // ----------------------------------------------------------
  console.log("👥 Creating employees...");
  let totalEmployees = 0;

  for (const { team, config } of teams) {
    const employeeData = generateEmployees(team.id, config, 20);
    await prisma.employee.createMany({ data: employeeData });
    totalEmployees += employeeData.length;
    console.log(`   ✓ ${team.name}: ${employeeData.length} employees`);
  }
  console.log(`   Total: ${totalEmployees} employees\n`);

  // ----------------------------------------------------------
  // Step 5: Create team assignments (TEAM_MANAGER → 1 team)
  // ----------------------------------------------------------
  // The TEAM_MANAGER can only see the Engineering team
  // This tests RBAC scoping — they shouldn't see Marketing or Sales
  console.log("🔗 Creating team assignments...");

  const engineeringTeam = teams[0].team; // Platform Engineering
  await prisma.teamAssignment.create({
    data: {
      userId: teamManager.id,
      teamId: engineeringTeam.id,
    },
  });
  console.log(`   ✓ ${teamManager.firstName} ${teamManager.lastName} → ${engineeringTeam.name}`);

  console.log();

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------
  console.log("═══════════════════════════════════════════");
  console.log("✅ Seed completed successfully!");
  console.log("═══════════════════════════════════════════");
  console.log();
  console.log("📊 Data Summary:");
  console.log(`   Users:            4`);
  console.log(`   Teams:            ${teams.length}`);
  console.log(`   Employees:        ${totalEmployees}`);
  console.log(`   Team Assignments: 1`);
  console.log();
  console.log("🔑 Login Credentials (all use password: Password123!):");
  console.log(`   ADMIN:        admin@hrinsight.com`);
  console.log(`   HR_MANAGER:   hr.manager@hrinsight.com`);
  console.log(`   TEAM_MANAGER: team.manager@hrinsight.com`);
  console.log(`   VIEWER:       viewer@hrinsight.com`);
  console.log();
  console.log("🏢 Teams:");
  for (const { team, config } of teams) {
    console.log(`   ${team.name} (${config.department}) — salary range: $${config.salaryRange[0].toLocaleString()}-$${config.salaryRange[1].toLocaleString()}`);
  }
  console.log();
}

// ============================================================
// Execute
// ============================================================
main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

---

## Understanding the Seed Script — Key Concepts

### Why `import "dotenv/config"` and `PrismaPg` adapter?

```typescript
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

**Prisma v7 requires three things to connect:**
1. `import "dotenv/config"` — loads `.env` file so `process.env.DATABASE_URL` is available
2. `PrismaPg` adapter — the JavaScript-native PostgreSQL driver (replaces the old Rust engine)
3. Pass the adapter to `new PrismaClient({ adapter })` — tells Prisma how to connect

Without `dotenv/config`, `process.env.DATABASE_URL` would be `undefined` and the connection would fail. Without the adapter, Prisma v7 throws: "PrismaClient needs to be constructed with a non-empty, valid PrismaClientOptions".

### Why bcrypt the password?

```typescript
const passwordHash = await hashPassword("Password123!");
```

We never store plain-text passwords. Even in seed data, we hash them with bcrypt. This way:
- The `login` endpoint will work correctly (it compares `bcrypt.hash(input)` vs `storedHash`)
- Good habit — always hash, even in development
- All 4 users share the same password (`Password123!`) for easy testing

### Why deleteMany() first?

```typescript
await prisma.riskSnapshot.deleteMany();
await prisma.actionPlan.deleteMany();
// ...
await prisma.user.deleteMany();
```

The seed script is **idempotent** — you can run it multiple times safely. Each run clears all existing data and re-creates fresh data. The deletion order matters because of foreign keys:
- Can't delete `employees` before `risk_snapshots` (snapshots reference employees)
- Can't delete `teams` before `employees` (employees reference teams)
- Can't delete `users` before `reports` (reports reference users)

We delete from "leaves" inward to "roots" of the relationship tree.

### Why createMany for employees?

```typescript
await prisma.employee.createMany({ data: employeeData });
```

`createMany` inserts all 20 employees in a single database query (one `INSERT INTO ... VALUES (...), (...), (...)` statement). This is much faster than 20 individual `create()` calls, which would be 20 separate database round-trips. For 60 employees, that's 3 queries instead of 60.

### The Employee Data Design

The employee generator creates realistic patterns that the ML model can learn from:

**High-risk patterns** (likely to leave):
- Low engagement (1.5-2.5) + high overtime (15-25 hrs) → burnout
- Long time since promotion (>36 months) + high performance → frustrated top performer
- High absenteeism (>15 days) + low engagement → checked out

**Low-risk patterns** (likely to stay):
- High engagement (4.0-5.0) + recent promotion → happy and growing
- Good training hours (40-80) + moderate overtime → invested in and not overworked
- High performance + high engagement → thriving

**Realistic correlations:**
- Performance is loosely correlated with engagement (but not perfectly — some disengaged employees still perform well, some engaged ones are still learning)
- Absenteeism is inversely correlated with engagement
- Salary increases with tenure (tenure bonus)
- Promotion gap can't exceed tenure

These patterns are what make the ML model interesting — there are clear signals, but also noise and exceptions, just like real HR data.

---

## Step D: Run the seed

```bash
cd /home/syrine/hr-insight-ai/backend
npx prisma db seed
```

**Expected output:**
```
🌱 Starting seed...

🧹 Cleaning existing data...
   ✓ All tables cleared

👤 Creating users...
   ✓ ADMIN: admin@hrinsight.com
   ✓ HR_MANAGER: hr.manager@hrinsight.com
   ✓ TEAM_MANAGER: team.manager@hrinsight.com
   ✓ VIEWER: viewer@hrinsight.com

🏢 Creating teams...
   ✓ Platform Engineering (Engineering)
   ✓ Growth Marketing (Marketing)
   ✓ Enterprise Sales (Sales)

👥 Creating employees...
   ✓ Platform Engineering: 20 employees
   ✓ Growth Marketing: 20 employees
   ✓ Enterprise Sales: 20 employees
   Total: 60 employees

🔗 Creating team assignments...
   ✓ Michael Chen → Platform Engineering

═══════════════════════════════════════════
✅ Seed completed successfully!
═══════════════════════════════════════════

📊 Data Summary:
   Users:            4
   Teams:            3
   Employees:        60
   Team Assignments: 1

🔑 Login Credentials (all use password: Password123!):
   ADMIN:        admin@hrinsight.com
   HR_MANAGER:   hr.manager@hrinsight.com
   TEAM_MANAGER: team.manager@hrinsight.com
   VIEWER:       viewer@hrinsight.com

🏢 Teams:
   Platform Engineering (Engineering) — salary range: $75,000-$145,000
   Growth Marketing (Marketing) — salary range: $55,000-$105,000
   Enterprise Sales (Sales) — salary range: $50,000-$120,000
```

---

## Step E: Verify the data

### Option 1: Prisma Studio (recommended)

```bash
cd /home/syrine/hr-insight-ai/backend
npx prisma studio
```

Open `http://localhost:5555` and check:

1. **users** table: 4 rows (admin, hr.manager, team.manager, viewer)
2. **teams** table: 3 rows (Platform Engineering, Growth Marketing, Enterprise Sales)
3. **employees** table: 60 rows with varied metrics
4. **team_assignments** table: 1 row (Michael Chen → Platform Engineering)
5. Click on any employee — verify all fields have realistic values

### Option 2: Neon SQL Editor

Go to [console.neon.tech](https://console.neon.tech) → SQL Editor → run:

```sql
-- Count all tables
SELECT 'users' as table_name, COUNT(*) FROM users
UNION ALL SELECT 'teams', COUNT(*) FROM teams
UNION ALL SELECT 'employees', COUNT(*) FROM employees
UNION ALL SELECT 'team_assignments', COUNT(*) FROM team_assignments;

-- Check employee data quality
SELECT
  t.name as team,
  COUNT(*) as employees,
  ROUND(AVG(e.salary)::numeric, 0) as avg_salary,
  ROUND(AVG(e.engagement_score)::numeric, 2) as avg_engagement,
  ROUND(AVG(e.performance_score)::numeric, 2) as avg_performance,
  ROUND(AVG(e.overtime_hours)::numeric, 1) as avg_overtime
FROM employees e
JOIN teams t ON e.team_id = t.id
GROUP BY t.name;
```

You should see 20 employees per team with different average metrics across departments.

---

## Checklist (confirm before moving to Step 8)

- [ ] `tsx` installed as dev dependency
- [ ] `prisma.config.ts` updated with seed command
- [ ] `prisma/seed.ts` created with full seed script
- [ ] `npx prisma db seed` runs successfully
- [ ] Prisma Studio shows: 4 users, 3 teams, 60 employees, 1 team assignment
- [ ] Employee data has varied, realistic values (not all the same)
- [ ] All users have `password_hash` populated (not plain text)

---

Once confirmed, I'll generate **Step 8: Verify All 3 Services Start** — the final step of Phase 1 where we confirm everything works together.
