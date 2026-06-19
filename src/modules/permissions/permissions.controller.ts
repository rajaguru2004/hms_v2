import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SystemRole } from '../../common/enums/role.enum';
import { Permission } from '../../common/enums/permission.enum';

@ApiTags('Permissions')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @Roles(SystemRole.SUPER_ADMIN)
  @Permissions(Permission.PERMISSION_READ)
  @ApiOperation({
    summary: 'Get all permissions for dynamic role creation matrix',
  })
  async findAll() {
    return this.permissionsService.findAll();
  }
}
