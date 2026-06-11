import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permission.enum';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { DashboardService } from './dashboard.service';
import { DashboardResponseDto } from './dto/dashboard.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @Permissions(Permission.DASHBOARD_READ)
  @ApiOperation({ summary: 'Get hospital dashboard statistics' })
  @ApiResponse({
    status: 200,
    type: DashboardResponseDto,
    description: 'Dashboard stats and breakdowns',
  })
  async getDashboard(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<DashboardResponseDto> {
    return this.service.getDashboardData(currentUser.organizationId);
  }
}
