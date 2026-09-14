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
import { BadRequestException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

/** Result files the parsers understand: CSV, Excel, HL7 and plain text. */
const RESULTS_UPLOAD_MIME_TYPES = [
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/**
 * Analyser exports routinely arrive as `application/octet-stream` — the browser
 * has no mapping for `.hl7`, and several instrument bridges send every file
 * that way. Rejecting on MIME alone would block the machines this endpoint
 * exists for, so for that one type the extension decides.
 */
const RESULTS_UPLOAD_EXTENSIONS = ['.csv', '.xls', '.xlsx', '.hl7', '.txt'];

const RESULTS_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

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
  // Unbounded before: the whole upload was buffered in memory before any
  // parser saw it, so one oversized or unparseable file took the process with
  // it rather than returning a 400.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: RESULTS_UPLOAD_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        const name = (file.originalname || '').toLowerCase();
        const accepted =
          RESULTS_UPLOAD_MIME_TYPES.includes(file.mimetype) ||
          (file.mimetype === 'application/octet-stream' &&
            RESULTS_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext)));

        if (!accepted) {
          callback(
            new BadRequestException(
              `Unsupported file type "${file.mimetype}". Allowed types: ${RESULTS_UPLOAD_MIME_TYPES.join(', ')}; application/octet-stream is accepted only for ${RESULTS_UPLOAD_EXTENSIONS.join(', ')} files.`,
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
