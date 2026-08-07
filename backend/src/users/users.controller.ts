import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service.js';
import { UpdateRoleDto, AssignTeamsDto } from './dto/index.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

// All routes in this controller require ADMIN role
@ApiTags('Users')
@ApiBearerAuth('bearer')
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private usersService: UsersService) {}

  // GET /users — list all users
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // GET /users/:id — get one user by UUID
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  // PATCH /users/:id/role — change a user's role
  @Patch(':id/role')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(id, dto);
  }

  // POST /users/:id/assign-teams — assign teams to a TEAM_MANAGER
  @Post(':id/assign-teams')
  assignTeams(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTeamsDto,
  ) {
    return this.usersService.assignTeams(id, dto);
  }

  // DELETE /users/:id — remove a user
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}