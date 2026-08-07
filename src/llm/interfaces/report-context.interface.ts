export interface ReportContext {
  teamName: string;
  department: string;
  teamSize: number;
  dateRange: { start: string; end: string };

  overallRiskScore: number;

  riskDistribution: {
    low: number;
    medium: number;
    high: number;
  };

  predictions: Array<{
    employeeName: string;
    riskScore: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    topDrivers: Array<{ feature: string; importance: number }>;
  }>;

  teamMetrics: {
    avgSalary: number;
    avgTenure: number;
    avgEngagement: number;
    avgPerformance: number;
    avgAbsenteeism: number;
    avgOvertime: number;
  };
}
