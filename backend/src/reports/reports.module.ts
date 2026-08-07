import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LlmModule } from '../llm/llm.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ReportsGateway } from './reports.gateway.js';
import { AiClientService } from './ai-client.service.js';
import { PdfService } from './pdf.service.js';

@Module({
  imports: [
    LlmModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsGateway, AiClientService, PdfService],
  exports: [ReportsService, AiClientService],
})
export class ReportsModule {}
