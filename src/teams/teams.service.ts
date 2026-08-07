import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTeamDto, UpdateTeamDto } from './dto/index.js';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string, userRole: string) {
    const where =
      userRole === 'TEAM_MANAGER'
        ? {
            teamAssignments: {
              some: { userId },
            },
          }
        : {};

    return this.prisma.team.findMany({
      where,
      include: {
        _count: {
          select: { employees: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, userId: string, userRole: string) {
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(id, userId);
    }

    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        employees: {
          orderBy: { name: 'asc' },
        },
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!team) throw new NotFoundException(`Team with id "${id}" not found`);
    return team;
  }

  async create(dto: CreateTeamDto) {
    return this.prisma.team.create({
      data: {
        name: dto.name,
        department: dto.department,
      },
    });
  }

  async update(
    id: string,
    dto: UpdateTeamDto,
    userId: string,
    userRole: string,
  ) {
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(id, userId);
    }

    await this.assertTeamExists(id);

    return this.prisma.team.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.assertTeamExists(id);

    await this.prisma.team.delete({ where: { id } });
    return { message: `Team "${id}" deleted successfully` };
  }

  private async assertTeamAccess(teamId: string, userId: string) {
    const assignment = await this.prisma.teamAssignment.findFirst({
      where: { userId, teamId },
    });
    if (!assignment) {
      throw new ForbiddenException(
        'You do not have access to this team',
      );
    }
  }

  private async assertTeamExists(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException(`Team with id "${id}" not found`);
  }
}
