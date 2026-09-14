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
import { InpatientService, InpatientStats } from './inpatient.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { resolveOrganizationId } from '../../common/utils/tenant.util';
import {
  InpatientQueryDto,
  InpatientPostCompatDto,
  InpatientPatchCompatDto,
} from './dto/inpatient-compat.dto';
import { CreateWardDto, UpdateWardDto, WardResponseDto } from './dto/ward.dto';
import { CreateBedDto, UpdateBedDto, BedResponseDto } from './dto/bed.dto';
import {
  AdmissionListQueryDto,
  CreateAdmissionDto,
  UpdateAdmissionDto,
  AdmissionResponseDto,
} from './dto/admission.dto';
import { PaginatedResult } from '../../common/types/paginated.type';
import { Admission } from '@prisma/client';

@ApiTags('Inpatient')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('inpatient')
export class InpatientController {
  constructor(private readonly inpatientService: InpatientService) {}

  // =========================================================================
  // BACKWARD COMPATIBILITY MULTIPLEXED ROUTES
  // =========================================================================

  @Get()
  @Permissions(Permission.INPATIENT_READ)
  @ApiOperation({
    summary: 'Multiplexed GET route matching Next.js API compatibility',
    description:
      'Supports resource query param: wards, beds, admissions, stats',
  })
  async compatibilityGet(
    @Query() query: InpatientQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const resource = query.resource || 'wards';
    let resultData: unknown;

    if (resource === 'wards') {
      resultData = await this.inpatientService.getWards(
        currentUser.organizationId,
      );
    } else if (resource === 'beds') {
      resultData = await this.inpatientService.getBeds(
        currentUser.organizationId,
        query.wardId,
        query.status,
      );
    } else if (resource === 'admissions') {
      resultData = await this.inpatientService.getAdmissions(
        currentUser.organizationId,
        query.status,
      );
    } else if (resource === 'stats') {
      resultData = await this.inpatientService.getStats(
        currentUser.organizationId,
      );
    } else {
      throw new BadRequestException('Invalid resource specified');
    }

    return resultData;
  }

  @Post()
  @Permissions(Permission.INPATIENT_CREATE)
  @ApiOperation({
    summary: 'Multiplexed POST route matching Next.js API compatibility',
    description: 'Creates ward, bed, or admission based on body.resource',
  })
  async compatibilityPost(
    @Body() dto: InpatientPostCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const resource = dto.resource || 'ward';

    if (resource === 'ward') {
      if (!dto.name) {
        throw new BadRequestException('name is required for ward creation');
      }
      const ward = await this.inpatientService.createWard(
        {
          name: dto.name,
          code: dto.code,
          type: dto.type,
          capacity: dto.capacity,
          departmentId: dto.departmentId,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return ward;
    }

    if (resource === 'bed') {
      if (!dto.wardId || !dto.bedNumber) {
        throw new BadRequestException(
          'wardId and bedNumber are required for bed creation',
        );
      }
      const bed = await this.inpatientService.createBed(
        {
          wardId: dto.wardId,
          bedNumber: dto.bedNumber,
          type: dto.type,
          status: dto.status,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return bed;
    }

    if (resource === 'admission') {
      if (!dto.patientId) {
        throw new BadRequestException(
          'patientId is required for patient admission',
        );
      }
      const admission = await this.inpatientService.createAdmission(
        {
          patientId: dto.patientId,
          bedId: dto.bedId,
          admissionType: dto.admissionType,
          admissionReason: dto.admissionReason,
          admittingDoctorId: dto.admittingDoctorId,
          attendingDoctorId: dto.attendingDoctorId,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return admission;
    }

    throw new BadRequestException('Invalid resource specified');
  }

  @Patch()
  @Permissions(Permission.INPATIENT_UPDATE)
  @ApiOperation({
    summary: 'Multiplexed PATCH route matching Next.js API compatibility',
    description: 'Updates ward, bed, or admission based on body.resource',
  })
  async compatibilityPatch(
    @Body() dto: InpatientPatchCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    let updated: unknown;

    if (dto.resource === 'ward') {
      updated = await this.inpatientService.updateWard(
        dto.id,
        {
          name: dto.name,
          code: dto.code,
          type: dto.type,
          capacity: dto.capacity,
          departmentId: dto.departmentId,
          isActive: dto.isActive,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else if (dto.resource === 'bed') {
      updated = await this.inpatientService.updateBed(
        dto.id,
        {
          wardId: dto.wardId,
          bedNumber: dto.bedNumber,
          type: dto.type,
          status: dto.status,
          currentPatientId: dto.currentPatientId,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else if (dto.resource === 'admission') {
      updated = await this.inpatientService.updateAdmission(
        dto.id,
        {
          patientId: dto.patientId,
          bedId: dto.bedId,
          admissionType: dto.admissionType,
          admissionReason: dto.admissionReason,
          admittingDoctorId: dto.admittingDoctorId,
          attendingDoctorId: dto.attendingDoctorId,
          status: dto.status,
          dischargeReason: dto.dischargeReason,
          dischargeSummary: dto.dischargeSummary,
          dischargeDoctorId: dto.dischargeDoctorId,
          dischargeDate: dto.dischargeDate,
          followUpDate: dto.followUpDate,
          followUpNotes: dto.followUpNotes,
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

  @Get('wards')
  @Permissions(Permission.INPATIENT_READ)
  @ApiOperation({ summary: 'Get all active wards with occupancy calculation' })
  @ApiResponse({ status: 200, type: [WardResponseDto] })
  async getWards(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.inpatientService.getWards(currentUser.organizationId);
  }

  @Post('wards')
  @Permissions(Permission.INPATIENT_CREATE)
  @ApiOperation({ summary: 'Create a new ward' })
  @ApiResponse({ status: 201, type: WardResponseDto })
  async createWard(
    @Body() dto: CreateWardDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.inpatientService.createWard(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('wards/:id')
  @Permissions(Permission.INPATIENT_UPDATE)
  @ApiOperation({ summary: 'Update ward details' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: WardResponseDto })
  async updateWard(
    @Param('id') id: string,
    @Body() dto: UpdateWardDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.inpatientService.updateWard(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('beds')
  @Permissions(Permission.INPATIENT_READ)
  @ApiOperation({ summary: 'Get beds with optional filters' })
  @ApiResponse({ status: 200, type: [BedResponseDto] })
  async getBeds(
    @Query('wardId') wardId: string,
    @Query('status') status: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.inpatientService.getBeds(
      currentUser.organizationId,
      wardId,
      status,
    );
  }

  @Post('beds')
  @Permissions(Permission.INPATIENT_CREATE)
  @ApiOperation({ summary: 'Create a new bed in a ward' })
  @ApiResponse({ status: 201, type: BedResponseDto })
  async createBed(
    @Body() dto: CreateBedDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.inpatientService.createBed(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('beds/:id')
  @Permissions(Permission.INPATIENT_UPDATE)
  @ApiOperation({ summary: 'Update bed details or status' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: BedResponseDto })
  async updateBed(
    @Param('id') id: string,
    @Body() dto: UpdateBedDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.inpatientService.updateBed(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('admissions')
  @Permissions(Permission.INPATIENT_READ)
  @ApiOperation({
    summary: 'Get patient admissions',
    description:
      'Returns a bare array. Send "page" to receive {data, meta} instead.',
  })
  @ApiResponse({ status: 200, type: [AdmissionResponseDto] })
  async getAdmissions(
    @Query() query: AdmissionListQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<Admission[] | PaginatedResult<Admission>> {
    const organizationId = resolveOrganizationId(currentUser);

    if (query.isPaged) {
      return this.inpatientService.getAdmissionsPaginated(organizationId, {
        status: query.status,
        search: query.search,
        page: query.pageNumber,
        limit: query.pageSize,
      });
    }

    return this.inpatientService.getAdmissions(
      organizationId,
      query.status,
      query.search,
    );
  }

  @Post('admissions')
  @Permissions(Permission.INPATIENT_CREATE)
  @ApiOperation({ summary: 'Admit a patient to a bed' })
  @ApiResponse({ status: 201, type: AdmissionResponseDto })
  async createAdmission(
    @Body() dto: CreateAdmissionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.inpatientService.createAdmission(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('admissions/:id')
  @Permissions(Permission.INPATIENT_UPDATE)
  @ApiOperation({ summary: 'Update admission details or discharge patient' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AdmissionResponseDto })
  async updateAdmission(
    @Param('id') id: string,
    @Body() dto: UpdateAdmissionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.inpatientService.updateAdmission(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('stats')
  @Permissions(Permission.INPATIENT_READ)
  @ApiOperation({ summary: 'Get inpatient occupancy statistics' })
  async getStats(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<InpatientStats> {
    return this.inpatientService.getStats(currentUser.organizationId);
  }
}
