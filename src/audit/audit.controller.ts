import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from './audit.service.js';
import { QueryAuditDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Audit Logs')
@ApiBearerAuth('bearer')
@Controller('audit-logs')
@Roles(Role.ADMIN, Role.HR_MANAGER)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  findAll(@Query() query: QueryAuditDto) {
    return this.auditService.findAll(query);
  }
}
