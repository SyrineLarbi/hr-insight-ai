import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { SimulationService } from './simulation.service.js';
import { OverviewService } from './overview.service.js';
import { AnalyticsController } from './analytics.controller.js';
import { ReportsModule } from '../reports/reports.module.js';

// ReportsModule supplies AiClientService, which the simulation re-uses so both
// paths share the same timeout, retry, and API-key configuration.
@Module({
  imports: [ReportsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SimulationService, OverviewService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
