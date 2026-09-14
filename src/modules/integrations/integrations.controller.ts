import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntegrationsService } from './integrations.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CreateMachineDto, UpdateMachineDto } from './dto/machine.dto';
import { ResultsQueueQueryDto, MachineQueryDto } from './dto/results-queue.dto';
import { resolveOrganizationId } from '../../common/utils/tenant.util';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('machines')
  @Permissions(Permission.INTEGRATION_READ)
  @ApiOperation({ summary: 'Get all machine integrations' })
  async getMachines(
    @Query() query: MachineQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const orgId = query.organizationId || currentUser.organizationId;
    return this.integrationsService.getMachines(orgId, query);
  }

  @Get('machines/:id')
  @Permissions(Permission.INTEGRATION_READ)
  @ApiOperation({ summary: 'Get machine integration details' })
  @ApiParam({ name: 'id', type: String })
  async getMachineById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.integrationsService.getMachineById(
      id,
      currentUser.organizationId,
    );
  }

  @Post('machines')
  @Permissions(Permission.INTEGRATION_CREATE)
  @ApiOperation({ summary: 'Register a new machine integration' })
  async createMachine(
    @Body() dto: CreateMachineDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.integrationsService.createMachine(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('machines/:id')
  @Permissions(Permission.INTEGRATION_UPDATE)
  @ApiOperation({ summary: 'Update machine integration configuration' })
  @ApiParam({ name: 'id', type: String })
  async updateMachine(
    @Param('id') id: string,
    @Body() dto: UpdateMachineDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.integrationsService.updateMachine(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete('machines/:id')
  @Permissions(Permission.INTEGRATION_DELETE)
  @ApiOperation({ summary: 'Delete machine integration' })
  @ApiParam({ name: 'id', type: String })
  async deleteMachine(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.integrationsService.deleteMachine(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('results-queue')
  @Permissions(Permission.INTEGRATION_READ)
  @ApiOperation({ summary: 'Get results from the import queue' })
  async getResultsQueue(
    @Query() query: ResultsQueueQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const orgId = query.organizationId || currentUser.organizationId;
    return this.integrationsService.getResultsQueue(orgId, query);
  }

  @Post('results/upload')
  @Permissions(Permission.INTEGRATION_CREATE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        organizationId: {
          type: 'string',
        },
        machineIntegrationId: {
          type: 'string',
        },
      },
    },
  })
  async uploadResultsFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('organizationId') organizationId?: string,
    @Body('machineIntegrationId') machineIntegrationId?: string,
    @CurrentUser() currentUser?: AuthenticatedUser,
  ) {
    const orgId = resolveOrganizationId(currentUser, organizationId);
    return this.integrationsService.uploadResultsFile(
      file?.buffer,
      file?.originalname || 'upload.csv',
      machineIntegrationId,
      orgId,
      currentUser?.id,
    );
  }
}
