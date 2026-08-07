import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { HealthService } from './health.service.js';

@ApiTags('Health')
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe — is the process up' })
  @ApiOkResponse({ description: 'Process is accepting requests' })
  live() {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe — database, AI service, and LLM key',
  })
  @ApiOkResponse({ description: 'All downstreams reachable' })
  async ready(@Res() res: Response) {
    const result = await this.healthService.ready();

    // 503 when a hard dependency is down, so orchestrators and the smoke test
    // can branch on the status code alone. `degraded` still returns 200 — the
    // app is usable, just without ML predictions or LLM prose.
    const status =
      result.status === 'down' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;

    res.status(status).json(result);
  }
}
