import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
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
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { resolveOrganizationId } from '../../common/utils/tenant.util';
import { ObjectStorageService } from '../../storage/object-storage.service';

/**
 * What a hospital's mark may be, and how big.
 *
 * SVG is deliberately absent: it is a script container, it would be served
 * back to every browser that renders the site's branding, and a logo is not
 * worth that.
 */
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Two megabytes. A logo that needs more than that is the wrong asset. */
const LOGO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
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
  constructor(
    private readonly settingsService: SettingsService,
    private readonly storage: ObjectStorageService,
  ) {}

  // ── SITE ───────────────────────────────────────────────────────────────────

  /**
   * The site map every signed-in client reads to render itself.
   *
   * No `@Permissions` by design: currency, clock format, triage vocabulary and
   * the wait-breach threshold are things a screen obeys, not things a user
   * administers. Gating it behind SETTINGS_READ is why every clinician got a
   * 403 here and silently fell back to defaults that were not their hospital's.
   */
  @Get()
  @ApiOperation({ summary: "The signed-in user's site configuration" })
  async getSiteSettings(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<Record<string, string>> {
    return this.settingsService.getSiteSettings(
      resolveOrganizationId(currentUser),
    );
  }

  // ── DEPARTMENTS ────────────────────────────────────────────────────────────

  @Get('departments')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get all departments for an organization' })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  async getDepartments(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.settingsService.findAllDepartments(
      resolveOrganizationId(currentUser, organizationId),
    );
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
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  async getIntegrations(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.settingsService.findAllIntegrations(
      resolveOrganizationId(currentUser, organizationId),
    );
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
  @ApiOperation({ summary: "Get the signed-in user's organization" })
  @ApiQuery({
    name: 'id',
    required: false,
    type: String,
    description: 'SUPER_ADMIN only; everyone else gets their own organisation',
  })
  async getOrganization(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('id') id?: string,
  ): Promise<OrganizationWithModules> {
    return this.settingsService.findOrganizationById(
      resolveOrganizationId(currentUser, id),
    );
  }

  @Put('organization')
  @Permissions(Permission.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Update organization configuration' })
  async updateOrganization(
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrganizationWithModules> {
    return this.settingsService.updateOrganization(
      resolveOrganizationId(currentUser, dto.id),
      dto,
      currentUser.id,
    );
  }

  /**
   * Stores a hospital's logo and answers with its address.
   *
   * The app's profile screen has always posted here; the route did not exist,
   * so changing a site's mark meant going to the web console — on a product
   * whose own record says the phone is the primary platform. The record itself
   * is not written here: the screen sends the address back through
   * `PUT organization` with everything else it changed, so one save is one
   * audit entry.
   */
  @Post('organization/logo')
  @Permissions(Permission.SETTINGS_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LOGO_UPLOAD_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
          callback(
            new BadRequestException(
              `Unsupported file type "${file.mimetype}". Allowed types: ${LOGO_MIME_TYPES.join(', ')}.`,
              ErrorCodes.VALIDATION_ERROR,
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: "Upload a hospital's logo or wordmark" })
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body('type') type?: string,
  ): Promise<{ url: string; type: string }> {
    // `logoText` is the wordmark, anything else the symbol. A site draws the
    // two separately and both live on the same record, so the answer says
    // which one came back rather than leaving the caller to remember.
    const mark = type === 'logoText' ? 'logoText' : 'logo';
    const url = await this.storage.upload(file, {
      organizationId: resolveOrganizationId(currentUser),
      folder: `branding/${mark}`,
      allowedMimeTypes: LOGO_MIME_TYPES,
    });
    return { url, type: mark };
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
    return this.settingsService.findAllUsers(
      resolveOrganizationId(currentUser, organizationId),
      role,
    );
  }

  @Get('users/:id')
  @Permissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', type: String })
  async getUserById(@Param('id') id: string) {
    return this.settingsService.findUserById(id);
  }

  /**
   * Creating a staff account is user administration, so it needs USER_CREATE as
   * well as SETTINGS_UPDATE. Without that, anyone who could edit the hospital's
   * address could also mint accounts and assign them roles.
   */
  @Post('users')
  @Permissions(Permission.SETTINGS_UPDATE, Permission.USER_CREATE)
  @ApiOperation({ summary: 'Create a new user' })
  async createUser(
    @Body() dto: CreateSettingsUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.settingsService.createUser(
      resolveOrganizationId(currentUser, dto.organizationId),
      dto,
      currentUser.id,
    );
  }

  @Put('users/:id')
  @Permissions(Permission.SETTINGS_UPDATE, Permission.USER_UPDATE)
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
  @Permissions(Permission.SETTINGS_UPDATE, Permission.USER_DELETE)
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
