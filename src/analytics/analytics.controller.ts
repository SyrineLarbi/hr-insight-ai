import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AnalyticsService } from './analytics.service.js';
import { SimulationService } from './simulation.service.js';
import { OverviewService } from './overview.service.js';
import { SimulateDto } from './dto/simulate.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

type AuthUser = { id: string; email: string; role: string };

@ApiTags('Analytics')
@ApiBearerAuth('bearer')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private analyticsService: AnalyticsService,
    private simulationService: SimulationService,
    private overviewService: OverviewService,
  ) {}

  @Get('team/:teamId')
  @ApiOperation({ summary: 'Aggregated metrics for one team' })
  getTeamAnalytics(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.analyticsService.getTeamAnalytics(teamId, user.id, user.role);
  }

  @Get('heatmap')
  @ApiOperation({
    summary: 'Risk heatmap — one row per visible team, normalised per metric',
  })
  getRiskHeatmap(@CurrentUser() user: AuthUser) {
    return this.overviewService.getRiskHeatmap(user.id, user.role);
  }

  @Get('compare')
  @ApiOperation({ summary: 'Side-by-side comparison of two teams' })
  compareTeams(
    @Query('teamA', ParseUUIDPipe) teamA: string,
    @Query('teamB', ParseUUIDPipe) teamB: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.overviewService.compareTeams(teamA, teamB, user.id, user.role);
  }

  // POST because it runs two model inferences, but it writes nothing. VIEWERs are
  // excluded since each call is a real cost against the AI service.
  @Post('simulate')
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  @ApiOperation({
    summary: 'Re-predict a team with adjusted metrics (read-only what-if)',
  })
  simulate(@Body() dto: SimulateDto, @CurrentUser() user: AuthUser) {
    return this.simulationService.simulate(dto, user.id, user.role);
  }
}
