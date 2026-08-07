import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AiClientService,
  AiEmployeeInput,
} from '../reports/ai-client.service.js';
import { SimulateDto } from './dto/simulate.dto.js';

export interface SimulationEmployeeResult {
  id: string;
  name: string;
  baselineRisk: number;
  simulatedRisk: number;
  delta: number;
}

export interface SimulationResult {
  teamId: string;
  teamName: string;
  employeeCount: number;
  baseline: { riskScore: number; distribution: Record<string, number> };
  simulated: { riskScore: number; distribution: Record<string, number> };
  deltaRiskScore: number;
  employees: SimulationEmployeeResult[];
  appliedAdjustments: Record<string, number>;
}

/** Bounds that keep adjusted inputs inside the model's trained domain. */
const CLAMPS = {
  salaryMin: 1,
  scoreMin: 1,
  scoreMax: 5,
  zeroFloor: 0,
  tenureMin: 1,
};

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private prisma: PrismaService,
    private aiClient: AiClientService,
  ) {}

  /**
   * Runs the team through the model twice — once as-is, once with the deltas
   * applied — and reports the difference. Nothing is written: this is a
   * read-only what-if, so no risk snapshots and no audit entry for a data change
   * that did not happen.
   */
  async simulate(
    dto: SimulateDto,
    userId: string,
    userRole: string,
  ): Promise<SimulationResult> {
    if (userRole === 'TEAM_MANAGER') {
      const assignment = await this.prisma.teamAssignment.findFirst({
        where: { userId, teamId: dto.teamId },
      });
      if (!assignment) {
        throw new ForbiddenException('You do not have access to this team');
      }
    }

    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
      include: { employees: true },
    });

    if (!team) {
      throw new NotFoundException(`Team with id "${dto.teamId}" not found`);
    }
    if (team.employees.length === 0) {
      throw new NotFoundException('This team has no employees to simulate');
    }

    const baselineInputs = team.employees.map((e) => this.toAiInput(e));
    const simulatedInputs = team.employees.map((e) =>
      this.applyAdjustments(this.toAiInput(e), dto),
    );

    // Two calls in parallel — they are independent, and the AI service handles
    // concurrent requests fine.
    const [baseline, simulated] = await Promise.all([
      this.aiClient.predictTeam(baselineInputs),
      this.aiClient.predictTeam(simulatedInputs),
    ]);

    const employees: SimulationEmployeeResult[] = team.employees.map(
      (emp, idx) => {
        const before = Math.round(baseline.predictions[idx].risk_score * 100);
        const after = Math.round(simulated.predictions[idx].risk_score * 100);
        return {
          id: emp.id,
          name: emp.name,
          baselineRisk: before,
          simulatedRisk: after,
          delta: after - before,
        };
      },
    );

    const baselineScore = Math.round(baseline.team_risk_score * 100);
    const simulatedScore = Math.round(simulated.team_risk_score * 100);

    this.logger.log(
      `Simulation on ${team.name}: ${baselineScore}% -> ${simulatedScore}%`,
    );

    return {
      teamId: team.id,
      teamName: team.name,
      employeeCount: team.employees.length,
      baseline: {
        riskScore: baselineScore,
        distribution: baseline.risk_distribution,
      },
      simulated: {
        riskScore: simulatedScore,
        distribution: simulated.risk_distribution,
      },
      deltaRiskScore: simulatedScore - baselineScore,
      employees,
      appliedAdjustments: this.describeAdjustments(dto),
    };
  }

  private toAiInput(emp: {
    salary: number;
    tenureMonths: number;
    engagementScore: number;
    performanceScore: number;
    absenteeismDays: number;
    overtimeHours: number;
    lastPromotionMonths: number;
    trainingHours: number;
  }): AiEmployeeInput {
    return {
      salary: emp.salary,
      tenureMonths: emp.tenureMonths,
      engagementScore: emp.engagementScore,
      performanceScore: emp.performanceScore,
      absenteeismDays: emp.absenteeismDays,
      overtimeHours: emp.overtimeHours,
      lastPromotionMonths: emp.lastPromotionMonths,
      trainingHours: emp.trainingHours,
    };
  }

  /**
   * Applies the deltas, clamping each result into the model's valid range.
   * Without the clamps a -50% salary slider on a low earner, or a -2 engagement
   * delta on someone already at 1.0, produces inputs the scaler never saw.
   */
  private applyAdjustments(
    input: AiEmployeeInput,
    dto: SimulateDto,
  ): AiEmployeeInput {
    const salaryPercent = dto.salaryPercent ?? 0;

    return {
      salary: Math.max(
        CLAMPS.salaryMin,
        input.salary * (1 + salaryPercent / 100),
      ),
      // Tenure is not adjustable — it is a fact about the past, not a lever.
      tenureMonths: Math.max(CLAMPS.tenureMin, input.tenureMonths),
      engagementScore: clamp(
        input.engagementScore + (dto.engagementDelta ?? 0),
        CLAMPS.scoreMin,
        CLAMPS.scoreMax,
      ),
      performanceScore: clamp(
        input.performanceScore + (dto.performanceDelta ?? 0),
        CLAMPS.scoreMin,
        CLAMPS.scoreMax,
      ),
      absenteeismDays: Math.max(
        CLAMPS.zeroFloor,
        input.absenteeismDays + (dto.absenteeismDelta ?? 0),
      ),
      overtimeHours: Math.max(
        CLAMPS.zeroFloor,
        input.overtimeHours + (dto.overtimeDelta ?? 0),
      ),
      // Cannot have gone longer without promotion than you have been employed.
      lastPromotionMonths: clamp(
        input.lastPromotionMonths + (dto.promotionDelta ?? 0),
        CLAMPS.zeroFloor,
        input.tenureMonths,
      ),
      trainingHours: Math.max(
        CLAMPS.zeroFloor,
        input.trainingHours + (dto.trainingDelta ?? 0),
      ),
    };
  }

  private describeAdjustments(dto: SimulateDto): Record<string, number> {
    const applied: Record<string, number> = {};
    const entries: Array<[string, number | undefined]> = [
      ['salaryPercent', dto.salaryPercent],
      ['engagementDelta', dto.engagementDelta],
      ['performanceDelta', dto.performanceDelta],
      ['overtimeDelta', dto.overtimeDelta],
      ['trainingDelta', dto.trainingDelta],
      ['promotionDelta', dto.promotionDelta],
      ['absenteeismDelta', dto.absenteeismDelta],
    ];

    for (const [key, value] of entries) {
      if (value !== undefined && value !== 0) applied[key] = value;
    }
    return applied;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
