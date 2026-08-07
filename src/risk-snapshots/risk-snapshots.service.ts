import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RiskSnapshotsService {
  private readonly logger = new Logger(RiskSnapshotsService.name);

  constructor(private prisma: PrismaService) {}

  async getEmployeeHistory(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, teamId: true },
    });

    if (!employee) {
      return { employee: null, snapshots: [] };
    }

    const snapshots = await this.prisma.riskSnapshot.findMany({
      where: { employeeId },
      orderBy: { snapshotDate: 'asc' },
    });

    return { employee, snapshots };
  }
}
