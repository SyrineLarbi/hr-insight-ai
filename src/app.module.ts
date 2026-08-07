import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { AuditModule } from './audit/audit.module.js';
import { TeamsModule } from './teams/teams.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { LlmModule } from './llm/llm.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RiskSnapshotsModule } from './risk-snapshots/risk-snapshots.module.js';
import { HealthModule } from './health/health.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Two buckets: a sustained per-minute window, plus a burst allowance that
    // absorbs the parallel requests a page load fires. The unnamed throttler is
    // registered as 'default', which is the name @Throttle() overrides on the
    // auth routes.
    ThrottlerModule.forRoot({
      throttlers: [
        { ttl: 60_000, limit: 200 },
        { name: 'burst', ttl: 1_000, limit: 25 },
      ],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AuditModule,
    TeamsModule,
    EmployeesModule,
    AnalyticsModule,
    LlmModule,
    ReportsModule,
    RiskSnapshotsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: throttle before authenticating so unauthenticated floods
    // are rejected without a database round-trip.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
