import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto, LoginDto } from './dto/index.js';
import type { JwtPayload } from './strategies/jwt.strategy.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ============================
  // REGISTER
  // ============================
  async register(dto: RegisterDto) {
    // 1. Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // 2. Hash the password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 3. Create the user (default role: VIEWER unless specified)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role ?? 'VIEWER',
      },
    });

    // 4. Generate JWT token
    const token = this.generateToken(user.id, user.email, user.role);

    // 5. Return user info + token (never return passwordHash!)
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      access_token: token,
    };
  }

  // ============================
  // LOGIN
  // ============================
  async login(dto: LoginDto) {
    // 1. Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // Don't reveal whether the email exists or not (security best practice)
      throw new UnauthorizedException('Invalid email or password');
    }

    // 2. Compare password with stored hash
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // 3. Generate JWT token
    const token = this.generateToken(user.id, user.email, user.role);

    // 4. Return user info + token
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      access_token: token,
    };
  }

  // ============================
  // GET PROFILE (for authenticated user)
  // ============================
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        teamAssignments: {
          select: {
            team: {
              select: { id: true, name: true, department: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      ...user,
      // Flatten team assignments for easier frontend use
      assignedTeams: user.teamAssignments.map((ta) => ta.team),
    };
  }

  // ============================
  // HELPER: Generate JWT token
  // ============================
  private generateToken(userId: string, email: string, role: string): string {
    const payload: JwtPayload = {
      sub: userId,   // "sub" (subject) is a standard JWT claim
      email,
      role,
    };
    return this.jwtService.sign(payload);
  }
}