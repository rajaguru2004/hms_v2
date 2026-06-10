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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { PharmacyService } from './pharmacy.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  PharmacyQueryDto,
  PharmacyPostCompatDto,
  PharmacyPatchCompatDto,
} from './dto/pharmacy-compat.dto';
import {
  CreatePharmacyDrugDto,
  UpdatePharmacyDrugDto,
  PharmacyDrugResponseDto,
} from './dto/pharmacy-drug.dto';
import {
  CreatePrescriptionDto,
  UpdatePrescriptionDto,
  PrescriptionResponseDto,
  PrescriptionItemDto,
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
    @Req() req: Request,
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

    return {
      success: true,
      data: resultData,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
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
    @Req() req: Request,
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
      return {
        success: true,
        data: drug,
        message: 'Drug added successfully',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
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
      return {
        success: true,
        data: prescription,
        message: 'Prescription created',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
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
      return {
        success: true,
        data: sale,
        message: 'Sale completed',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
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
    @Req() req: Request,
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

  @Get('drugs')
  @Permissions(Permission.PHARMACY_READ)
  @ApiOperation({ summary: 'Get active drugs catalog' })
  @ApiResponse({ status: 200, type: [PharmacyDrugResponseDto] })
  async getDrugs(
    @Query('category') category: string,
    @Query('search') search: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.getDrugs(
      currentUser.organizationId,
      category,
      search,
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
  @ApiOperation({ summary: 'Get prescriptions' })
  @ApiResponse({ status: 200, type: [PrescriptionResponseDto] })
  async getPrescriptions(
    @Query('status') status: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.pharmacyService.getPrescriptions(
      currentUser.organizationId,
      status,
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
