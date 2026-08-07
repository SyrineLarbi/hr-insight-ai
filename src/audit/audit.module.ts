import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService],
})
export class AuditModule {}
