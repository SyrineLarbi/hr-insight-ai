/**
 * Turnover cost model.
 *
 * The multiplier convention comes from the project brief: replacing an employee
 * costs 1.5x–2x their annual salary once hiring, onboarding, lost productivity,
 * and the morale hit on the remaining team are counted. Everything here is a
 * pure function of its inputs so the numbers on screen can be traced back to an
 * assumption the user can see and change.
 */

export interface RoiAssumptions {
  /** Multiple of annual salary it costs to replace someone. */
  replacementCostMultiplier: number;
  /** Share of at-risk employees a retention programme actually saves (0-1). */
  interventionSuccessRate: number;
  /** Annual cost of running the retention programme, in dollars. */
  programmeCost: number;
}

export const DEFAULT_ASSUMPTIONS: RoiAssumptions = {
  replacementCostMultiplier: 1.5,
  interventionSuccessRate: 0.35,
  programmeCost: 25_000,
};

export interface RoiInput {
  /** Employees in scope, with salary and predicted risk (0-1). */
  employees: Array<{ salary: number; riskScore: number }>;
  assumptions: RoiAssumptions;
}

export interface RoiResult {
  headcount: number;
  /** Sum of salary x multiplier x risk — the risk-weighted cost of doing nothing. */
  expectedTurnoverCost: number;
  /** Portion of that cost a successful programme avoids. */
  avoidableCost: number;
  programmeCost: number;
  netSavings: number;
  /** Net savings per dollar spent. Null when the programme is free. */
  roiRatio: number | null;
  roiPercent: number | null;
  /** Months until net savings overtake programme cost. Null if never. */
  breakEvenMonths: number | null;
  costPerEmployee: number;
}

export function calculateRoi({ employees, assumptions }: RoiInput): RoiResult {
  const { replacementCostMultiplier, interventionSuccessRate, programmeCost } =
    assumptions;

  const headcount = employees.length;

  // Expected cost = probability-weighted, not a count of "high risk" employees.
  // Someone at 55% risk contributes real expected cost even though they sit in
  // the MEDIUM bucket, and bucketing would throw that away.
  const expectedTurnoverCost = employees.reduce(
    (sum, e) => sum + e.salary * replacementCostMultiplier * e.riskScore,
    0,
  );

  const avoidableCost = expectedTurnoverCost * interventionSuccessRate;
  const netSavings = avoidableCost - programmeCost;

  const roiRatio = programmeCost > 0 ? netSavings / programmeCost : null;

  // Savings accrue over a year, so monthly benefit is 1/12 of the avoidable
  // cost. Break-even is when cumulative benefit covers the programme.
  const monthlyBenefit = avoidableCost / 12;
  const breakEvenMonths =
    monthlyBenefit > 0 ? programmeCost / monthlyBenefit : null;

  return {
    headcount,
    expectedTurnoverCost: round(expectedTurnoverCost),
    avoidableCost: round(avoidableCost),
    programmeCost,
    netSavings: round(netSavings),
    roiRatio: roiRatio === null ? null : round(roiRatio, 2),
    roiPercent: roiRatio === null ? null : round(roiRatio * 100, 1),
    breakEvenMonths:
      breakEvenMonths === null ? null : round(breakEvenMonths, 1),
    costPerEmployee: headcount > 0 ? round(expectedTurnoverCost / headcount) : 0,
  };
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatCurrencyExact(value: number): string {
  return `${value < 0 ? '-' : ''}$${Math.abs(Math.round(value)).toLocaleString()}`;
}
