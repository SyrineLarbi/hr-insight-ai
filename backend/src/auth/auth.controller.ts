import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto } from './dto/index.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // POST /auth/register
  // 5 registrations per hour per IP — this endpoint creates rows, so it is the
  // cheapest way to flood the database.
  @Post('register')
  @Public()
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  @ApiOperation({ summary: 'Create an account (defaults to VIEWER role)' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /auth/login
  // 10 attempts per minute per IP. Enough for a human fumbling their password,
  // far too slow for credential stuffing.
  @Post('login')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK) // Login returns 200, not 201 (default for POST)
  @ApiOperation({ summary: 'Exchange credentials for a JWT' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // GET /auth/profile (protected — requires JWT)
  @Get('profile')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Current user with resolved permissions' })
  async getProfile(
    @CurrentUser() user: { id: string; email: string; role: string },
  ) {
    return this.authService.getProfile(user.id);
  }
}
