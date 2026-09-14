import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permission.enum';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  RadiologyPatchCompatDto,
  RadiologyPostCompatDto,
  RadiologyQueryDto,
} from './dto/radiology-compat.dto';
import {
  CreateRadiologyExamDto,
  RadiologyExamResponseDto,
  UpdateRadiologyExamDto,
} from './dto/radiology-exam.dto';
import {
  CreateRadiologyOrderDto,
  RadiologyOrderResponseDto,
  UpdateRadiologyOrderDto,
} from './dto/radiology-order.dto';
import {
  CreateRadiologyReportDto,
  RadiologyReportResponseDto,
  UpdateRadiologyReportDto,
} from './dto/radiology-report.dto';
import {
  RadiologyService,
  RADIOLOGY_UPLOAD_MAX_BYTES,
  RADIOLOGY_UPLOAD_MIME_TYPES,
} from './radiology.service';
import { RadiologyOrderListQueryDto } from './dto/radiology-order.dto';
import { resolveOrganizationId } from '../../common/utils/tenant.util';
import { PaginatedResult } from '../../common/types/paginated.type';
import { RadiologyOrder } from '@prisma/client';
import { BadRequestException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

@ApiTags('Radiology')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('radiology')
export class RadiologyController {
  constructor(private readonly radiologyService: RadiologyService) {}

  @Get()
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({
    summary: 'Multiplexed GET route matching legacy Next.js radiology API',
    description: 'Supports resource query param: exams, orders, reports, stats',
  })
  @ApiResponse({ status: 200, description: 'Radiology resource list or stats' })
  async compatibilityGet(
    @Query() query: RadiologyQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<unknown> {
    const result = await this.radiologyService.compatibilityGet(
      query,
      currentUser.organizationId,
    );

    return result.data;
  }

  @Post()
  @Permissions(Permission.RADIOLOGY_CREATE)
  @ApiOperation({
    summary: 'Multiplexed POST route matching legacy Next.js radiology API',
    description: 'Creates exam, order, or report based on body.resource',
  })
  @ApiResponse({ status: 201, description: 'Radiology resource created' })
  async compatibilityPost(
    @Body() dto: RadiologyPostCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<unknown> {
    const result = await this.radiologyService.compatibilityPost(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );

    return result.data;
  }

  @Patch()
  @Permissions(Permission.RADIOLOGY_UPDATE)
  @ApiOperation({
    summary: 'Multiplexed PATCH route matching legacy Next.js radiology API',
    description: 'Updates exam, order, or report based on body.resource',
  })
  @ApiResponse({ status: 200, description: 'Radiology resource updated' })
  async compatibilityPatch(
    @Body() dto: RadiologyPatchCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<unknown> {
    const result = await this.radiologyService.compatibilityPatch(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );

    return result.data;
  }

  @Get('exams')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({ summary: 'List active radiology exams' })
  @ApiResponse({ status: 200, type: RadiologyExamResponseDto, isArray: true })
  async listExams(
    @Query('category') category: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyExamResponseDto[]> {
    return this.radiologyService.getExams(currentUser.organizationId, category);
  }

  @Get('exams/:id')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({ summary: 'Get radiology exam by ID' })
  @ApiParam({ name: 'id', example: 'exam-cuid' })
  @ApiResponse({ status: 200, type: RadiologyExamResponseDto })
  async getExam(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyExamResponseDto> {
    return this.radiologyService.getExamById(id, currentUser.organizationId);
  }

  @Post('exams')
  @Permissions(Permission.RADIOLOGY_CREATE)
  @ApiOperation({ summary: 'Create radiology exam catalog item' })
  @ApiResponse({ status: 201, type: RadiologyExamResponseDto })
  async createExam(
    @Body() dto: CreateRadiologyExamDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyExamResponseDto> {
    return this.radiologyService.createExam(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('exams/:id')
  @Permissions(Permission.RADIOLOGY_UPDATE)
  @ApiOperation({ summary: 'Update radiology exam catalog item' })
  @ApiParam({ name: 'id', example: 'exam-cuid' })
  @ApiResponse({ status: 200, type: RadiologyExamResponseDto })
  async updateExam(
    @Param('id') id: string,
    @Body() dto: UpdateRadiologyExamDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyExamResponseDto> {
    return this.radiologyService.updateExam(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('orders')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({
    summary: 'List radiology orders',
    description:
      'Returns a bare array. Send "page" to receive {data, meta} instead.',
  })
  @ApiResponse({ status: 200, type: RadiologyOrderResponseDto, isArray: true })
  async listOrders(
    @Query() query: RadiologyOrderListQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyOrder[] | PaginatedResult<RadiologyOrder>> {
    const organizationId = resolveOrganizationId(currentUser);

    if (query.isPaged) {
      return this.radiologyService.getOrdersPaginated(organizationId, {
        status: query.status,
        urgency: query.urgency,
        patientId: query.patientId,
        search: query.search,
        page: query.pageNumber,
        limit: query.pageSize,
      });
    }

    return this.radiologyService.getOrders(
      organizationId,
      query.status,
      query.urgency,
      query.patientId,
      query.search,
    );
  }

  @Get('orders/:id')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({ summary: 'Get radiology order by ID' })
  @ApiParam({ name: 'id', example: 'order-cuid' })
  @ApiResponse({ status: 200, type: RadiologyOrderResponseDto })
  async getOrder(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyOrderResponseDto> {
    return this.radiologyService.getOrderById(id, currentUser.organizationId);
  }

  @Post('orders')
  @Permissions(Permission.RADIOLOGY_CREATE)
  @ApiOperation({ summary: 'Create radiology order' })
  @ApiResponse({ status: 201, type: RadiologyOrderResponseDto })
  async createOrder(
    @Body() dto: CreateRadiologyOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyOrderResponseDto> {
    return this.radiologyService.createOrder(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('orders/:id')
  @Permissions(Permission.RADIOLOGY_UPDATE)
  @ApiOperation({ summary: 'Update radiology order' })
  @ApiParam({ name: 'id', example: 'order-cuid' })
  @ApiResponse({ status: 200, type: RadiologyOrderResponseDto })
  async updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdateRadiologyOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyOrderResponseDto> {
    return this.radiologyService.updateOrder(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('reports')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({ summary: 'List radiology reports' })
  @ApiResponse({ status: 200, type: RadiologyReportResponseDto, isArray: true })
  async listReports(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('orderId') orderId?: string,
  ): Promise<RadiologyReportResponseDto[]> {
    return this.radiologyService.getReports(
      resolveOrganizationId(currentUser),
      orderId,
    );
  }

  @Get('reports/:id')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({ summary: 'Get radiology report by ID' })
  @ApiParam({ name: 'id', example: 'report-cuid' })
  @ApiResponse({ status: 200, type: RadiologyReportResponseDto })
  async getReport(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyReportResponseDto> {
    return this.radiologyService.getReportById(
      id,
      resolveOrganizationId(currentUser),
    );
  }

  @Post('reports')
  @Permissions(Permission.RADIOLOGY_CREATE)
  @ApiOperation({ summary: 'Create radiology report' })
  @ApiResponse({ status: 201, type: RadiologyReportResponseDto })
  async createReport(
    @Body() dto: CreateRadiologyReportDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyReportResponseDto> {
    return this.radiologyService.createReport(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('reports/:id')
  @Permissions(Permission.RADIOLOGY_UPDATE)
  @ApiOperation({ summary: 'Update radiology report' })
  @ApiParam({ name: 'id', example: 'report-cuid' })
  @ApiResponse({ status: 200, type: RadiologyReportResponseDto })
  async updateReport(
    @Param('id') id: string,
    @Body() dto: UpdateRadiologyReportDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyReportResponseDto> {
    return this.radiologyService.updateReport(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Post('upload')
  @Permissions(Permission.RADIOLOGY_CREATE)
  // Unbounded before: Multer buffered the whole body in memory, so a single
  // large POST — or a .zip renamed to .jpg — reached the S3 client and the
  // process heap with nothing in between.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: RADIOLOGY_UPLOAD_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        if (
          !(RADIOLOGY_UPLOAD_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          callback(
            new BadRequestException(
              `Unsupported file type "${file.mimetype}". Allowed types: ${RADIOLOGY_UPLOAD_MIME_TYPES.join(', ')}.`,
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
      },
    },
  })
  @ApiOperation({ summary: 'Upload an image attachment to S3' })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ url: string }> {
    const url = await this.radiologyService.uploadToS3(
      file,
      currentUser.organizationId,
    );
    return { url };
  }

  @Get('stats/summary')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({ summary: 'Get radiology dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Radiology stats summary' })
  async getStats(@CurrentUser() currentUser: AuthenticatedUser): Promise<{
    pending: number;
    inProgress: number;
    completedToday: number;
    criticalFindings: number;
    totalExams: number;
  }> {
    return this.radiologyService.getStats(currentUser.organizationId);
  }
}
