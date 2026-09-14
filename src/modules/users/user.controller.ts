import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto/user.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SystemRole } from '../../common/enums/role.enum';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { resolveOrganizationId } from '../../common/utils/tenant.util';

/**
 * UserController — REST API for user management.
 *
 * Auth: All routes require JWT (JwtAuthGuard applied globally).
 * RBAC: Additional role/permission guards per route.
 *
 * Pattern: Controller → Service → Repository → Prisma
 * Controller is thin — validation, extraction, delegation only.
 */
@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.ADMIN)
  @Permissions(Permission.USER_CREATE)
  @ApiOperation({ summary: 'Create a new user (Admin only)' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.create(dto, currentUser.id);
  }

  @Get('staff')
  @Permissions(Permission.PATIENT_READ)
  @ApiOperation({
    summary: 'List active staff by role (for clinical dropdowns)',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    type: String,
    description: 'Filter by role name e.g. DOCTOR',
  })
  async findStaff(
    @Query('role') role?: string,
    @CurrentUser() currentUser?: AuthenticatedUser,
  ) {
    return this.userService.findStaff(resolveOrganizationId(currentUser), role);
  }

  @Get()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.ADMIN)
  @Permissions(Permission.USER_READ)
  @ApiOperation({ summary: 'List all users with pagination' })
  async findAll(@Query() pagination: PaginationDto) {
    return this.userService.findAll(pagination);
  }

  @Get(':id')
  @Permissions(Permission.USER_READ)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', type: String })
  async findOne(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  @Put(':id')
  @Permissions(Permission.USER_UPDATE)
  @ApiOperation({ summary: 'Update user profile' })
  @ApiParam({ name: 'id', type: String })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.update(id, dto, currentUser.id);
  }

  @Delete(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.ADMIN)
  @Permissions(Permission.USER_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete user (Admin only)' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.userService.remove(id, currentUser.id);
  }
}
