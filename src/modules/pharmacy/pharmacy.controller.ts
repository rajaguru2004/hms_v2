import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { PharmacyService } from './pharmacy.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { resolveOrganizationId } from '../../common/utils/tenant.util';
import { PaginatedResult } from '../../common/types/paginated.type';
import { PharmacyDrug, Prescription } from '@prisma/client';
import {
  PharmacyQueryDto,
  PharmacyPostCompatDto,
  PharmacyPatchCompatDto,
} from './dto/pharmacy-compat.dto';
import {
  CreatePharmacyDrugDto,
  UpdatePharmacyDrugDto,
  PharmacyDrugResponseDto,
  DrugListQueryDto,
} from './dto/pharmacy-drug.dto';
import {
  CreatePrescriptionDto,
  UpdatePrescriptionDto,
  PrescriptionResponseDto,
  PrescriptionItemDto,
  PrescriptionListQueryDto,
} from './dto/prescription.dto';
import {
  CreatePharmacySaleDto,
  PharmacySaleResponseDto,
  PharmacySaleItemDto,
} from './dto/pharmacy-sale.dto';

@ApiTags('Pharmacy')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('pharmacy')
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  // =========================================================================
  // BACKWARD COMPATIBILITY MULTIPLEXED ROUTES
  // =========================================================================

  @Get()
  @Permissions(Permission.PHARMACY_READ)
  @ApiOperation({
    summary: 'Multiplexed GET route matching Next.js API compatibility',
    description:
      'Supports resource query param: drugs, prescriptions, sales, stats',
  })
  async compatibilityGet(
    @Query() query: PharmacyQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const resource = query.resource || 'drugs';
    let resultData: unknown;

    if (resource === 'drugs') {
      resultData = await this.pharmacyService.getDrugs(
        currentUser.organizationId,
        query.category,
        query.search,
      );
    } else if (resource === 'prescriptions') {
      resultData = await this.pharmacyService.getPrescriptions(
        currentUser.organizationId,
        query.status,
        query.patientId,
      );
    } else if (resource === 'sales') {
      resultData = await this.pharmacyService.getSales(
        currentUser.organizationId,
        query.date,
      );
    } else if (resource === 'stats') {
      resultData = await this.pharmacyService.getStats(
        currentUser.organizationId,
      );
    } else {
      throw new BadRequestException('Invalid resource specified');
    }

    return resultData;
  }

  @Post()
  @Permissions(Permission.PHARMACY_CREATE)
  @ApiOperation({
    summary: 'Multiplexed POST route matching Next.js API compatibility',
    description: 'Creates drug, prescription, or sale based on body.resource',
  })
  async compatibilityPost(
    @Body() dto: PharmacyPostCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const resource = dto.resource || 'drug';

    if (resource === 'drug') {
      if (!dto.drugName) {
        throw new BadRequestException('drugName is required for drug creation');
      }
      const drug = await this.pharmacyService.createDrug(
        currentUser.organizationId,
        {
          drugName: dto.drugName,
          genericName: dto.genericName,
          brandName: dto.brandName,
          drugCode: dto.drugCode,
          drugCategory: dto.drugCategory,
          dosageForm: dto.dosageForm,
          strength: dto.strength,
          quantityInStock: dto.quantityInStock,
          unitOfMeasure: dto.unitOfMeasure,
          reorderLevel: dto.reorderLevel,
          sellingPrice: dto.sellingPrice,
          costPrice: dto.costPrice,
          requiresPrescription: dto.requiresPrescription,
          storageLocation: dto.storageLocation,
          description: dto.description,
        },
        currentUser.id,
      );
      return drug;
    }

    if (resource === 'prescription') {
      if (
        !dto.patientId ||
        !dto.doctorId ||
        !dto.items ||
        dto.items.length === 0
      ) {
        throw new BadRequestException(
          'patientId, doctorId, and a non-empty items array are required for prescription creation',
        );
      }
      const prescription = await this.pharmacyService.createPrescription(
        currentUser.organizationId,
        {
          patientId: dto.patientId,
          doctorId: dto.doctorId,
          consultationId: dto.consultationId,
          items: dto.items as unknown as PrescriptionItemDto[],
          notes: dto.notes,
        },
        currentUser.id,
      );
      return prescription;
    }

    if (resource === 'sale') {
      if (!dto.items || dto.items.length === 0) {
        throw new BadRequestException(
          'items array is required and cannot be empty for sales',
        );
      }
      const sale = await this.pharmacyService.createSale(
        currentUser.organizationId,
        {
          patientId: dto.patientId,
          prescriptionId: dto.prescriptionId,
          items: dto.items as unknown as PharmacySaleItemDto[],
          paymentMethod: dto.paymentMethod,
          paymentStatus: dto.paymentStatus,
        },
        currentUser.id,
      );
      return sale;
    }

    throw new BadRequestException('Invalid resource specified');
  }

  @Patch()
  @Permissions(Permission.PHARMACY_UPDATE)
  @ApiOperation({
    summary: 'Multiplexed PATCH route matching Next.js API compatibility',
    description: 'Updates drug or prescription based on body.resource',
  })
  async compatibilityPatch(
    @Body() dto: PharmacyPatchCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    let updated: unknown;

    if (dto.resource === 'drug') {
      updated = await this.pharmacyService.updateDrug(
        dto.id,
        {
          drugName: dto.drugName,
          quantityInStock: dto.quantityInStock,
          sellingPrice: dto.sellingPrice,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else if (dto.resource === 'prescription') {
      updated = await this.pharmacyService.updatePrescription(
        dto.id,
        {
          status: dto.status,
          notes: dto.notes,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else {
      throw new BadRequestException('Invalid resource specified');
    }

    return updated;
  }

  // =========================================================================
  // ENHANCED RESTFUL ENDPOINTS
  // =========================================================================

  @Get('drugs')
  @Permissions(Permission.PHARMACY_READ)
  @ApiOperation({
    summary: 'Get active drugs catalog',
    description:
      'Returns a bare array. Send "page" to receive {data, meta} instead.',
  })
  @ApiResponse({ status: 200, type: [PharmacyDrugResponseDto] })
  async getDrugs(
    @Query() query: DrugListQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PharmacyDrug[] | PaginatedResult<PharmacyDrug>> {
    const organizationId = resolveOrganizationId(currentUser);

    if (query.isPaged) {
      return this.pharmacyService.getDrugsPaginated(organizationId, {
        category: query.category,
        search: query.search,
        page: query.pageNumber,
        limit: query.pageSize,
      });
    }

    return this.pharmacyService.getDrugs(
      organizationId,
      query.category,
      query.search,
    );
  }

  @Post('drugs')
  @Permissions(Permission.PHARMACY_CREATE)
  @ApiOperation({ summary: 'Create a new drug catalog entry' })
  @ApiResponse({ status: 201, type: PharmacyDrugResponseDto })
  async createDrug(
    @Body() dto: CreatePharmacyDrugDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.createDrug(
      currentUser.organizationId,
      dto,
      currentUser.id,
    );
  }

  @Patch('drugs/:id')
  @Permissions(Permission.PHARMACY_UPDATE)
  @ApiOperation({ summary: 'Update drug details' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: PharmacyDrugResponseDto })
  async updateDrug(
    @Param('id') id: string,
    @Body() dto: UpdatePharmacyDrugDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.updateDrug(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('prescriptions')
  @Permissions(Permission.PHARMACY_READ)
  @ApiOperation({
    summary: 'Get prescriptions',
    description:
      'Returns a bare array. Send "page" to receive {data, meta} instead.',
  })
  @ApiResponse({ status: 200, type: [PrescriptionResponseDto] })
  async getPrescriptions(
    @Query() query: PrescriptionListQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<Prescription[] | PaginatedResult<Prescription>> {
    const organizationId = resolveOrganizationId(currentUser);

    if (query.isPaged) {
      return this.pharmacyService.getPrescriptionsPaginated(organizationId, {
        status: query.status,
        patientId: query.patientId,
        search: query.search,
        page: query.pageNumber,
        limit: query.pageSize,
      });
    }

    return this.pharmacyService.getPrescriptions(
      organizationId,
      query.status,
      query.patientId,
      query.search,
    );
  }

  @Post('prescriptions')
  @Permissions(Permission.PHARMACY_CREATE)
  @ApiOperation({ summary: 'Create a new prescription' })
  @ApiResponse({ status: 201, type: PrescriptionResponseDto })
  async createPrescription(
    @Body() dto: CreatePrescriptionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.createPrescription(
      currentUser.organizationId,
      dto,
      currentUser.id,
    );
  }

  @Patch('prescriptions/:id')
  @Permissions(Permission.PHARMACY_UPDATE)
  @ApiOperation({ summary: 'Update prescription details' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: PrescriptionResponseDto })
  async updatePrescription(
    @Param('id') id: string,
    @Body() dto: UpdatePrescriptionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.updatePrescription(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('sales')
  @Permissions(Permission.PHARMACY_READ)
  @ApiOperation({ summary: 'Get pharmacy sales' })
  @ApiResponse({ status: 200, type: [PharmacySaleResponseDto] })
  async getSales(
    @Query('date') date: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.getSales(currentUser.organizationId, date);
  }

  @Post('sales')
  @Permissions(Permission.PHARMACY_CREATE)
  @ApiOperation({ summary: 'Process a new drug sale' })
  @ApiResponse({ status: 201, type: PharmacySaleResponseDto })
  async createSale(
    @Body() dto: CreatePharmacySaleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.createSale(
      currentUser.organizationId,
      dto,
      currentUser.id,
    );
  }

  @Get('stats')
  @Permissions(Permission.PHARMACY_READ)
  @ApiOperation({ summary: 'Get pharmacy inventory and sales statistics' })
  async getStats(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.pharmacyService.getStats(currentUser.organizationId);
  }
}
