import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ReportsService } from './reports.service.js';
import { PdfService } from './pdf.service.js';
import { GenerateReportDto } from './dto/generate-report.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

type AuthUser = { id: string; email: string; role: string };

@ApiTags('Reports')
@ApiBearerAuth('bearer')
@Controller('reports')
export class ReportsController {
  constructor(
    private reportsService: ReportsService,
    private pdfService: PdfService,
  ) {}

  @Post('generate')
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  generate(@Body() dto: GenerateReportDto, @CurrentUser() user: AuthUser) {
    return this.reportsService.generateReport(dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.reportsService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reportsService.findOne(id, user);
  }

  // Latest risk snapshot per employee on the report's team. findOne() runs the
  // RBAC check first, so this cannot be used to read another team's scores.
  @Get(':id/risk-snapshots')
  async riskSnapshots(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.reportsService.findOne(id, user);
    return this.reportsService.getReportRiskSnapshots(id);
  }

  @Get(':id/pdf')
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  async exportPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const report: any = await this.reportsService.findOne(id, user);
    const employees = report.team?.employees || [];
    const riskSnapshots =
      await this.reportsService.getReportRiskSnapshots(id);

    const pdfBuffer = await this.pdfService.generatePdf(
      report,
      employees,
      riskSnapshots,
    );

    await this.reportsService.logPdfExport(id, user.id);

    const teamName = (report.team?.name || 'report')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase();
    const date = new Date().toISOString().split('T')[0];
    const filename = `hr-insight-${teamName}-${date}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length.toString(),
    });

    res.end(pdfBuffer);
  }
}
