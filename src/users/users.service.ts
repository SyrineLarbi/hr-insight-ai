import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateRoleDto, AssignTeamsDto } from './dto/index.js';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ============================
  // LIST ALL USERS (ADMIN only)
  // ============================
  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        teamAssignments: {
          select: {
            team: { select: { id: true, name: true, department: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ============================
  // GET ONE USER (ADMIN only)
  // ============================
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        teamAssignments: {
          select: {
            team: { select: { id: true, name: true, department: true } },
          },
        },
      },
    });

    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    return user;
  }

  // ============================
  // UPDATE USER ROLE (ADMIN only)
  // ============================
  async updateRole(id: string, dto: UpdateRoleDto) {
    // Verify user exists first
    await this.findOne(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: dto.role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    return updated;
  }

  // ============================
  // ASSIGN TEAMS TO USER (ADMIN only)
  // Used for TEAM_MANAGER role — gives access to specific teams
  // ============================
  async assignTeams(userId: string, dto: AssignTeamsDto) {
    // Verify user exists
    await this.findOne(userId);

    // Verify all teamIds exist
    const teams = await this.prisma.team.findMany({
      where: { id: { in: dto.teamIds } },
      select: { id: true },
    });

    if (teams.length !== dto.teamIds.length) {
      const foundIds = teams.map((t) => t.id);
      const missing = dto.teamIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(`Teams not found: ${missing.join(', ')}`);
    }

    // Replace all existing team assignments (atomic: delete old + create new)
    await this.prisma.$transaction([
      this.prisma.teamAssignment.deleteMany({ where: { userId } }),
      this.prisma.teamAssignment.createMany({
        data: dto.teamIds.map((teamId) => ({ userId, teamId })),
      }),
    ]);

    // Return updated user with new assignments
    return this.findOne(userId);
  }

  // ============================
  // DELETE USER (ADMIN only)
  // ============================
  async remove(id: string) {
    await this.findOne(id); // throws 404 if not found
    await this.prisma.user.delete({ where: { id } });
    return { message: `User ${id} deleted successfully` };
  }
}