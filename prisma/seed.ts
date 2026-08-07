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