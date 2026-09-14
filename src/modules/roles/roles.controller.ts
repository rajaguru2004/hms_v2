import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
  AssignUserRoleDto,
} from './dto/roles.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
/**
 * Authorisation here is by permission, not by role name.
 *
 * These routes used to carry `@Roles(SUPER_ADMIN)` *and* a `ROLE_*` permission,
 * so an administrator whose access map said they could read roles still got a
 * 403 — the product lets a hospital define its own roles, and a check on a
 * hard-coded role name is a check that cannot follow them. The permission
 * decorators below are the real gate, and `RolesService` still refuses to
 * modify a system role whoever is asking.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions(Permission.ROLE_READ)
  @ApiOperation({ summary: 'List all roles (System + Organization specific)' })
  async findAll(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.rolesService.findAll(currentUser.organizationId);
  }

  @Get(':id')
  @Permissions(Permission.ROLE_READ)
  @ApiOperation({ summary: 'Get a specific role by ID with permissions' })
  @ApiParam({ name: 'id', type: String })
  async findOne(@Param('id') id: string) {
    return this.rolesService.findById(id);
  }

  @Post()
  @Permissions(Permission.ROLE_CREATE)
  @ApiOperation({ summary: 'Create a new custom organization-specific role' })
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    // Force role to belong to current user's organization
    dto.organizationId = currentUser.organizationId;
    return this.rolesService.create(dto, currentUser.id);
  }

  @Patch(':id')
  @Permissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: 'Update custom role name or description' })
  @ApiParam({ name: 'id', type: String })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.rolesService.update(id, dto, currentUser.id);
  }

  @Delete(':id')
  @Permissions(Permission.ROLE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete a custom role' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.rolesService.softDelete(id, currentUser.id);
  }

  @Put(':id/permissions')
  @Permissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: 'Assign permissions to a custom role' })
  @ApiParam({ name: 'id', type: String })
  async assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.rolesService.assignPermissions(id, dto, currentUser.id);
    return { message: 'Permissions assigned successfully' };
  }

  @Post(':id/users')
  @Permissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: 'Assign a user to a role' })
  @ApiParam({ name: 'id', type: String })
  async assignUser(
    @Param('id') id: string,
    @Body() dto: AssignUserRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.rolesService.assignUserToRole(id, dto.userId, currentUser.id);
    return { message: 'User assigned to role successfully' };
  }

  @Delete(':id/users/:userId')
  @Permissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: 'Remove a user from a role' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'userId', type: String })
  async removeUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.rolesService.removeUserFromRole(id, userId, currentUser.id);
    return { message: 'User removed from role successfully' };
  }
}
