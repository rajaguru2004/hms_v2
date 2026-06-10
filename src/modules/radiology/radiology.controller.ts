import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
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
import { RadiologyService } from './radiology.service';

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
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const result = await this.radiologyService.compatibilityGet(
      query,
      currentUser.organizationId,
    );

    return {
      success: true,
      message: result.message || 'Operation completed successfully',
      data: result.data,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
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
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const result = await this.radiologyService.compatibilityPost(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );

    return {
      success: true,
      message: result.message || 'Operation completed successfully',
      data: result.data,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
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
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const result = await this.radiologyService.compatibilityPatch(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );

    return {
      success: true,
      message: result.message || 'Operation completed successfully',
      data: result.data,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
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
  @ApiOperation({ summary: 'List radiology orders' })
  @ApiResponse({ status: 200, type: RadiologyOrderResponseDto, isArray: true })
  async listOrders(
    @Query('status') status: string | undefined,
    @Query('urgency') urgency: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RadiologyOrderResponseDto[]> {
    return this.radiologyService.getOrders(
      currentUser.organizationId,
      status,
      urgency,
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
    @Query('orderId') orderId?: string,
  ): Promise<RadiologyReportResponseDto[]> {
    return this.radiologyService.getReports(orderId);
  }

  @Get('reports/:id')
  @Permissions(Permission.RADIOLOGY_READ)
  @ApiOperation({ summary: 'Get radiology report by ID' })
  @ApiParam({ name: 'id', example: 'report-cuid' })
  @ApiResponse({ status: 200, type: RadiologyReportResponseDto })
  async getReport(
    @Param('id') id: string,
  ): Promise<RadiologyReportResponseDto> {
    return this.radiologyService.getReportById(id);
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
