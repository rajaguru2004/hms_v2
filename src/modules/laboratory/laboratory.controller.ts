import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { LaboratoryService } from './laboratory.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  LaboratoryQueryDto,
  LaboratoryPostCompatDto,
  LaboratoryPatchCompatDto,
} from './dto/laboratory-compat.dto';
import {
  CreateLabTestDto,
  UpdateLabTestDto,
  LabTestResponseDto,
} from './dto/lab-test.dto';
import {
  CreateLabOrderDto,
  UpdateLabOrderDto,
  LabOrderResponseDto,
} from './dto/lab-order.dto';
import {
  CreateLabResultDto,
  UpdateLabResultDto,
  LabResultResponseDto,
} from './dto/lab-result.dto';

@ApiTags('Laboratory')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('laboratory')
export class LaboratoryController {
  constructor(private readonly laboratoryService: LaboratoryService) {}

  // =========================================================================
  // BACKWARD COMPATIBILITY MULTIPLEXED ROUTES
  // =========================================================================

  @Get()
  @Permissions(Permission.LABORATORY_READ)
  @ApiOperation({
    summary: 'Multiplexed GET route matching Next.js API compatibility',
    description: 'Supports resource query param: tests, orders, results, stats',
  })
  async compatibilityGet(
    @Query() query: LaboratoryQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const resource = query.resource || 'tests';
    let resultData: unknown;

    if (resource === 'tests') {
      resultData = await this.laboratoryService.getTests(
        currentUser.organizationId,
        query.category,
      );
    } else if (resource === 'orders') {
      resultData = await this.laboratoryService.getOrders(
        currentUser.organizationId,
        query.status,
        query.priority,
      );
    } else if (resource === 'results') {
      resultData = await this.laboratoryService.getResults(query.orderId);
    } else if (resource === 'stats') {
      resultData = await this.laboratoryService.getStats(
        currentUser.organizationId,
      );
    } else {
      throw new BadRequestException('Invalid resource specified');
    }

    return {
      success: true,
      data: resultData,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  @Post()
  @Permissions(Permission.LABORATORY_CREATE)
  @ApiOperation({
    summary: 'Multiplexed POST route matching Next.js API compatibility',
    description: 'Creates test, order, or result based on body.resource',
  })
  async compatibilityPost(
    @Body() dto: LaboratoryPostCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const resource = dto.resource || 'test';

    if (resource === 'test') {
      if (!dto.testName) {
        throw new BadRequestException('testName is required for test creation');
      }
      const test = await this.laboratoryService.createTest(
        {
          testName: dto.testName,
          testCode: dto.testCode,
          testCategory: dto.testCategory,
          testType: dto.testType,
          specimenType: dto.specimenType,
          specimenVolume: dto.specimenVolume,
          specimenContainer: dto.specimenContainer,
          resultType: dto.resultType,
          unit: dto.unit,
          referenceRanges: dto.referenceRanges,
          price: dto.price,
          turnaroundTime: dto.turnaroundTime,
          department: dto.department,
          preparationInstructions: dto.preparationInstructions,
          clinicalSignificance: dto.clinicalSignificance,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return {
        success: true,
        data: test,
        message: 'Test added successfully',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
    }

    if (resource === 'order') {
      if (!dto.patientId) {
        throw new BadRequestException(
          'patientId is required for order creation',
        );
      }
      if (!dto.tests || dto.tests.length === 0) {
        throw new BadRequestException(
          'tests array is required and cannot be empty',
        );
      }
      const order = await this.laboratoryService.createOrder(
        {
          patientId: dto.patientId,
          consultationId: dto.consultationId,
          tests: dto.tests,
          clinicalIndication: dto.clinicalIndication,
          provisionalDiagnosis: dto.provisionalDiagnosis,
          priority: dto.priority,
          notes: dto.notes,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return {
        success: true,
        data: order,
        message: 'Lab order created',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
    }

    if (resource === 'result') {
      if (!dto.orderId || !dto.testId || dto.resultValue === undefined) {
        throw new BadRequestException(
          'orderId, testId, and resultValue are required for saving results',
        );
      }
      const result = await this.laboratoryService.createResult(
        {
          orderId: dto.orderId,
          testId: dto.testId,
          resultValue: dto.resultValue,
          resultUnit: dto.resultUnit,
          isAbnormal: dto.isAbnormal,
          isCritical: dto.isCritical,
          flag: dto.flag,
          comment: dto.comment,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return {
        success: true,
        data: result,
        message: 'Result saved',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
    }

    throw new BadRequestException('Invalid resource specified');
  }

  @Patch()
  @Permissions(Permission.LABORATORY_UPDATE)
  @ApiOperation({
    summary: 'Multiplexed PATCH route matching Next.js API compatibility',
    description: 'Updates test, order, or result based on body.resource',
  })
  async compatibilityPatch(
    @Body() dto: LaboratoryPatchCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    let updated: unknown;

    if (dto.resource === 'test') {
      updated = await this.laboratoryService.updateTest(
        dto.id,
        {
          testName: dto.testName,
          price: dto.price,
          isActive: dto.isActive,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else if (dto.resource === 'order') {
      updated = await this.laboratoryService.updateOrder(
        dto.id,
        {
          status: dto.status,
          priority: dto.priority,
          notes: dto.notes,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else if (dto.resource === 'result') {
      updated = await this.laboratoryService.updateResult(
        dto.id,
        {
          resultValue: dto.resultValue,
          resultUnit: dto.resultUnit,
          isAbnormal: dto.isAbnormal,
          isCritical: dto.isCritical,
          flag: dto.flag,
          comment: dto.comment,
          verifiedAt: dto.verifiedAt ? new Date(dto.verifiedAt) : undefined,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else {
      throw new BadRequestException('Invalid resource specified');
    }

    return {
      success: true,
      data: updated,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  // =========================================================================
  // ENHANCED RESTFUL ENDPOINTS
  // =========================================================================

  @Get('tests')
  @Permissions(Permission.LABORATORY_READ)
  @ApiOperation({ summary: 'Get active laboratory tests' })
  @ApiResponse({ status: 200, type: [LabTestResponseDto] })
  async getTests(
    @Query('category') category: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.getTests(
      currentUser.organizationId,
      category,
    );
  }

  @Post('tests')
  @Permissions(Permission.LABORATORY_CREATE)
  @ApiOperation({ summary: 'Create a new laboratory test catalog entry' })
  @ApiResponse({ status: 201, type: LabTestResponseDto })
  async createTest(
    @Body() dto: CreateLabTestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.createTest(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('tests/:id')
  @Permissions(Permission.LABORATORY_UPDATE)
  @ApiOperation({ summary: 'Update a laboratory test' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: LabTestResponseDto })
  async updateTest(
    @Param('id') id: string,
    @Body() dto: UpdateLabTestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.updateTest(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete('tests/:id')
  @Permissions(Permission.LABORATORY_UPDATE)
  @ApiOperation({ summary: 'Delete a laboratory test (soft delete)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: LabTestResponseDto })
  async deleteTest(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.deleteTest(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('orders')
  @Permissions(Permission.LABORATORY_READ)
  @ApiOperation({ summary: 'Get laboratory orders' })
  @ApiResponse({ status: 200, type: [LabOrderResponseDto] })
  async getOrders(
    @Query('status') status: string,
    @Query('priority') priority: string,
    @Query('search') search: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;

    return this.laboratoryService.getOrders(
      currentUser.organizationId,
      status,
      priority,
      search,
      pageNumber,
      limitNumber,
    );
  }

  @Post('orders')
  @Permissions(Permission.LABORATORY_CREATE)
  @ApiOperation({ summary: 'Create a new laboratory order' })
  @ApiResponse({ status: 201, type: LabOrderResponseDto })
  async createOrder(
    @Body() dto: CreateLabOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.createOrder(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('orders/:id')
  @Permissions(Permission.LABORATORY_UPDATE)
  @ApiOperation({ summary: 'Update laboratory order status or details' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: LabOrderResponseDto })
  async updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdateLabOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.updateOrder(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('results')
  @Permissions(Permission.LABORATORY_READ)
  @ApiOperation({ summary: 'Get laboratory results' })
  @ApiResponse({ status: 200, type: [LabResultResponseDto] })
  async getResults(@Query('orderId') orderId: string) {
    return this.laboratoryService.getResults(orderId);
  }

  @Post('results')
  @Permissions(Permission.LABORATORY_CREATE)
  @ApiOperation({ summary: 'Add results to a laboratory test order' })
  @ApiResponse({ status: 201, type: LabResultResponseDto })
  async createResult(
    @Body() dto: CreateLabResultDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.createResult(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('results/:id')
  @Permissions(Permission.LABORATORY_UPDATE)
  @ApiOperation({ summary: 'Update results or verify them' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: LabResultResponseDto })
  async updateResult(
    @Param('id') id: string,
    @Body() dto: UpdateLabResultDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.laboratoryService.updateResult(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('stats')
  @Permissions(Permission.LABORATORY_READ)
  @ApiOperation({ summary: 'Get laboratory stats' })
  async getStats(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.laboratoryService.getStats(currentUser.organizationId);
  }
}
