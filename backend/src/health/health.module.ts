import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

// AiClientService comes from ReportsModule, which must export it for the
// readiness probe to reuse the same configured client.
@Module({
  imports: [PrismaModule, ReportsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
