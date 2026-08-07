// Loaded first: @WebSocketGateway reads FRONTEND_ORIGIN from process.env when
// its decorator is evaluated at import time, which happens before
// ConfigModule.forRoot() gets a chance to populate it.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { parseFrontendOrigins } from './common/cors-origins.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust the proxy so `req.ip` (used by the audit log and the rate limiter) is
  // the real client address rather than the load balancer's.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The Swagger UI loads its own inline scripts and styles; the default CSP
      // blocks them and leaves a blank page at /api/docs.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowedOrigins = parseFrontendOrigins(process.env.FRONTEND_ORIGIN);
  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('HR Insight AI API')
    .setDescription(
      'Predictive workforce analytics — teams, employees, ML risk predictions, ' +
        'LLM reports, and PDF export. All routes require a Bearer JWT except ' +
        '/auth/login, /auth/register, and /health.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addTag('Auth', 'Register, login, profile')
    .addTag('Users', 'ADMIN-only user and role management')
    .addTag('Teams', 'Team CRUD (RBAC-scoped)')
    .addTag('Employees', 'Employee CRUD (RBAC-scoped)')
    .addTag('Analytics', 'Team-level aggregations')
    .addTag('Reports', 'Report generation, retrieval, PDF export')
    .addTag('Risk Snapshots', 'Per-employee risk history')
    .addTag('Audit Logs', 'Audit trail (ADMIN / HR_MANAGER)')
    .addTag('Health', 'Liveness and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3010;
  await app.listen(port);

  logger.log(`Backend running on http://localhost:${port}`);
  logger.log(`API docs on http://localhost:${port}/api/docs`);
  logger.log(`CORS origins: ${allowedOrigins.join(', ')}`);
}
bootstrap();
