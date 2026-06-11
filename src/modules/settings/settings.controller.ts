import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SettingsService, OrganizationWithModules } from './settings.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreateSettingsIntegrationDto,
  UpdateSettingsIntegrationDto,
  UpdateModulesDto,
  UpdateOrganizationDto,
  CreateSettingsUserDto,
  UpdateSettingsUserDto,
} from './dto/settings.dto';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // ── DEPARTMENTS ────────────────────────────────────────────────────────────

  @Get('departments')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get all departments for an organization' })
  @ApiQuery({ name: 'organizationId', required: true, type: String })
  async getDepartments(@Query('organizationId') organizationId: string) {
    return this.settingsService.findAllDepartments(organizationId);
  }

  @Get('departments/:id')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get a single department by ID' })
  @ApiParam({ name: 'id', type: String })
  async getDepartmentById(@Param('id') id: string) {
    return this.settingsService.findDepartmentById(id);
  }

  @Post('departments')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Create a new department' })
  async createDepartment(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.createDepartment(dto, currentUser.id);
  }

  @Put('departments/:id')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Update a department by ID' })
  @ApiParam({ name: 'id', type: String })
  async updateDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.updateDepartment(id, dto, currentUser.id);
  }

  @Delete('departments/:id')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Delete a department by ID' })
  @ApiParam({ name: 'id', type: String })
  async deleteDepartment(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.settingsService.deleteDepartment(id, currentUser.id);
    return { success: true, message: 'Department deleted successfully' };
  }

  // ── INTEGRATIONS ───────────────────────────────────────────────────────────

  @Get('integrations')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get all machine integrations for an organization' })
  @ApiQuery({ name: 'organizationId', required: true, type: String })
  async getIntegrations(@Query('organizationId') organizationId: string) {
    return this.settingsService.findAllIntegrations(organizationId);
  }

  @Get('integrations/:id')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get machine integration details by ID' })
  @ApiParam({ name: 'id', type: String })
  async getIntegrationById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.findIntegrationById(
      id,
      currentUser.organizationId,
    );
  }

  @Post('integrations')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Register a new machine integration' })
  async createIntegration(
    @Body() dto: CreateSettingsIntegrationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.createIntegration(dto, currentUser.id);
  }

  @Put('integrations/:id')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Update machine integration configuration by ID' })
  @ApiParam({ name: 'id', type: String })
  async updateIntegration(
    @Param('id') id: string,
    @Body() dto: UpdateSettingsIntegrationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.updateIntegration(
      id,
      currentUser.organizationId,
      dto,
      currentUser.id,
    );
  }

  @Delete('integrations/:id')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Delete machine integration by ID' })
  @ApiParam({ name: 'id', type: String })
  async deleteIntegration(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.settingsService.deleteIntegration(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
    return { success: true, message: 'Integration deleted successfully' };
  }

  // ── MODULES ────────────────────────────────────────────────────────────────

  @Put('modules')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Update organization enabled modules' })
  async updateModules(
    @Body() dto: UpdateModulesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrganizationWithModules> {
    return this.settingsService.updateModules(dto, currentUser.id);
  }

  // ── ORGANIZATION ───────────────────────────────────────────────────────────

  @Get('organization')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get organization details by ID' })
  @ApiQuery({ name: 'id', required: true, type: String })
  async getOrganization(
    @Query('id') id: string,
  ): Promise<OrganizationWithModules> {
    return this.settingsService.findOrganizationById(id);
  }

  @Put('organization')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Update organization configuration' })
  async updateOrganization(
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrganizationWithModules> {
    return this.settingsService.updateOrganization(dto, currentUser.id);
  }

  // ── USERS ──────────────────────────────────────────────────────────────────

  @Get('users')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({
    summary: 'Get all users for organization with optional role filtering',
  })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @ApiQuery({ name: 'role', required: false, type: String })
  async getUsers(
    @Query('organizationId') organizationId?: string,
    @Query('role') role?: string,
    @CurrentUser() currentUser?: AuthenticatedUser,
  ) {
    const orgId = organizationId || currentUser?.organizationId || 'org-demo';
    return this.settingsService.findAllUsers(orgId, role);
  }

  @Get('users/:id')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', type: String })
  async getUserById(@Param('id') id: string) {
    return this.settingsService.findUserById(id);
  }

  @Post('users')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Create a new user' })
  async createUser(
    @Body() dto: CreateSettingsUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.createUser(dto, currentUser.id);
  }

  @Put('users/:id')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Update user settings by ID' })
  @ApiParam({ name: 'id', type: String })
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateSettingsUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.updateUser(id, dto, currentUser.id);
  }

  @Delete('users/:id')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Soft delete user by ID' })
  @ApiParam({ name: 'id', type: String })
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.settingsService.deleteUser(id, currentUser.id);
    return { success: true, message: 'User deleted successfully' };
  }
}
