import { Module } from '@nestjs/common';
import { RiskSnapshotsController } from './risk-snapshots.controller.js';
import { RiskSnapshotsService } from './risk-snapshots.service.js';

@Module({
  controllers: [RiskSnapshotsController],
  providers: [RiskSnapshotsService],
  exports: [RiskSnapshotsService],
})
export class RiskSnapshotsModule {}
