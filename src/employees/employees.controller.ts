import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { EmployeesService } from './employees.service.js';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

type AuthUser = { id: string; email: string; role: string };

@ApiTags('Employees')
@ApiBearerAuth('bearer')
@Controller('employees')
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Get()
  findAll(
    @Query('teamId') teamId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.findAll(teamId, user.id, user.role);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.findOne(id, user.id, user.role);
  }

  @Post()
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.create(dto, user.id, user.role);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.HR_MANAGER, Role.TEAM_MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.update(id, dto, user.id, user.role);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.remove(id);
  }
}
