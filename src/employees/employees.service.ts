import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/index.js';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    teamId: string | undefined,
    userId: string,
    userRole: string,
  ) {
    const where: Record<string, unknown> = {};
    if (teamId) where.teamId = teamId;

    if (userRole === 'TEAM_MANAGER') {
      where.team = {
        teamAssignments: {
          some: { userId },
        },
      };
    }

    return this.prisma.employee.findMany({
      where,
      include: {
        team: {
          select: { id: true, name: true, department: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, userId: string, userRole: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true, department: true } },
        riskSnapshots: {
          orderBy: { snapshotDate: 'desc' },
          take: 10,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id "${id}" not found`);
    }

    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(employee.teamId, userId);
    }

    return employee;
  }

  async create(dto: CreateEmployeeDto, userId: string, userRole: string) {
    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(dto.teamId, userId);
    }

    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    });
    if (!team) {
      throw new NotFoundException(`Team with id "${dto.teamId}" not found`);
    }

    return this.prisma.employee.create({ data: dto });
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    userId: string,
    userRole: string,
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with id "${id}" not found`);
    }

    if (userRole === 'TEAM_MANAGER') {
      await this.assertTeamAccess(employee.teamId, userId);
    }

    if (dto.teamId && dto.teamId !== employee.teamId) {
      const newTeam = await this.prisma.team.findUnique({
        where: { id: dto.teamId },
      });
      if (!newTeam) {
        throw new NotFoundException(`Team with id "${dto.teamId}" not found`);
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with id "${id}" not found`);
    }

    await this.prisma.employee.delete({ where: { id } });
    return { message: `Employee "${employee.name}" deleted successfully` };
  }

  private async assertTeamAccess(teamId: string, userId: string) {
    const assignment = await this.prisma.teamAssignment.findFirst({
      where: { userId, teamId },
    });
    if (!assignment) {
      throw new ForbiddenException(
        'You do not have access to employees in this team',
      );
    }
  }
}
