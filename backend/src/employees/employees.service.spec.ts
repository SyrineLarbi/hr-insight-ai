import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * RBAC scoping is the highest-risk logic in this codebase: a bug here leaks one
 * team's salary and performance data to another team's manager. These tests
 * assert on the Prisma `where` clause the service builds, because that clause is
 * the only thing standing between a TEAM_MANAGER and the whole employee table.
 */
describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: {
    employee: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    team: { findUnique: jest.Mock };
    teamAssignment: { findFirst: jest.Mock };
  };

  const MANAGER_ID = 'user-team-manager';
  const OWN_TEAM = 'team-owned';
  const OTHER_TEAM = 'team-not-owned';

  const employeeIn = (teamId: string) => ({
    id: 'emp-1',
    teamId,
    name: 'Jane Doe',
    salary: 60000,
  });

  beforeEach(async () => {
    prisma = {
      employee: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'new', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'emp-1', ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      team: { findUnique: jest.fn() },
      teamAssignment: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(EmployeesService);
  });

  describe('findAll — list scoping', () => {
    it('scopes a TEAM_MANAGER to teams they are assigned to', async () => {
      await service.findAll(undefined, MANAGER_ID, 'TEAM_MANAGER');

      const where = prisma.employee.findMany.mock.calls[0][0].where;
      expect(where.team).toEqual({
        teamAssignments: { some: { userId: MANAGER_ID } },
      });
    });

    it.each(['ADMIN', 'HR_MANAGER', 'VIEWER'])(
      'does not team-scope %s',
      async (role) => {
        await service.findAll(undefined, 'user-1', role);

        const where = prisma.employee.findMany.mock.calls[0][0].where;
        expect(where.team).toBeUndefined();
      },
    );

    it('keeps the assignment filter when a teamId is also supplied', async () => {
      // Without this, a TEAM_MANAGER could pass ?teamId=<other team> and the
      // explicit filter would replace the scoping instead of narrowing it.
      await service.findAll(OTHER_TEAM, MANAGER_ID, 'TEAM_MANAGER');

      const where = prisma.employee.findMany.mock.calls[0][0].where;
      expect(where.teamId).toBe(OTHER_TEAM);
      expect(where.team).toEqual({
        teamAssignments: { some: { userId: MANAGER_ID } },
      });
    });

    it('filters by teamId when one is supplied', async () => {
      await service.findAll(OWN_TEAM, 'admin', 'ADMIN');

      expect(prisma.employee.findMany.mock.calls[0][0].where.teamId).toBe(
        OWN_TEAM,
      );
    });
  });

  describe('findOne — detail scoping', () => {
    it('throws 404 for an unknown id', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing', 'admin', 'ADMIN')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets a TEAM_MANAGER read an employee on an assigned team', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeIn(OWN_TEAM));
      prisma.teamAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });

      await expect(
        service.findOne('emp-1', MANAGER_ID, 'TEAM_MANAGER'),
      ).resolves.toMatchObject({ teamId: OWN_TEAM });
    });

    it('blocks a TEAM_MANAGER reading an employee on an unassigned team', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeIn(OTHER_TEAM));
      prisma.teamAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('emp-1', MANAGER_ID, 'TEAM_MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not check assignments for HR_MANAGER', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeIn(OTHER_TEAM));

      await service.findOne('emp-1', 'hr-1', 'HR_MANAGER');

      expect(prisma.teamAssignment.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('blocks a TEAM_MANAGER creating into an unassigned team', async () => {
      prisma.teamAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { teamId: OTHER_TEAM, name: 'New Hire' } as never,
          MANAGER_ID,
          'TEAM_MANAGER',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.employee.create).not.toHaveBeenCalled();
    });

    it('allows a TEAM_MANAGER creating into an assigned team', async () => {
      prisma.teamAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
      prisma.team.findUnique.mockResolvedValue({ id: OWN_TEAM });

      await service.create(
        { teamId: OWN_TEAM, name: 'New Hire' } as never,
        MANAGER_ID,
        'TEAM_MANAGER',
      );

      expect(prisma.employee.create).toHaveBeenCalled();
    });

    it('throws 404 when the target team does not exist', async () => {
      prisma.team.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ teamId: 'ghost', name: 'X' } as never, 'admin', 'ADMIN'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('blocks a TEAM_MANAGER updating an employee outside their teams', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeIn(OTHER_TEAM));
      prisma.teamAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.update('emp-1', { salary: 1 } as never, MANAGER_ID, 'TEAM_MANAGER'),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('throws 404 when moving an employee to a team that does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeIn(OWN_TEAM));
      prisma.team.findUnique.mockResolvedValue(null);

      await expect(
        service.update(
          'emp-1',
          { teamId: 'ghost' } as never,
          'admin',
          'ADMIN',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('skips the team lookup when teamId is unchanged', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeIn(OWN_TEAM));

      await service.update(
        'emp-1',
        { teamId: OWN_TEAM, salary: 70000 } as never,
        'admin',
        'ADMIN',
      );

      expect(prisma.team.findUnique).not.toHaveBeenCalled();
      expect(prisma.employee.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws 404 for an unknown id and does not delete', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.employee.delete).not.toHaveBeenCalled();
    });

    it('deletes an existing employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(employeeIn(OWN_TEAM));

      const result = await service.remove('emp-1');

      expect(prisma.employee.delete).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
      });
      expect(result.message).toContain('Jane Doe');
    });
  });
});
