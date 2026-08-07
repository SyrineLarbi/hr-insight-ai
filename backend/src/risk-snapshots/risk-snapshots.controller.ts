import { Controller, Get, Param } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RiskSnapshotsService } from './risk-snapshots.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Risk Snapshots')
@ApiBearerAuth('bearer')
@Controller('risk-snapshots')
export class RiskSnapshotsController {
  constructor(private riskSnapshotsService: RiskSnapshotsService) {}

  @Get('employee/:employeeId')
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  getEmployeeHistory(@Param('employeeId') employeeId: string) {
    return this.riskSnapshotsService.getEmployeeHistory(employeeId);
  }
}
