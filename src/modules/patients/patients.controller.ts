import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { PatientResponseDto } from './dto/patient-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('Patients')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @Permissions(Permission.PATIENT_CREATE)
  @ApiOperation({ summary: 'Register a new patient' })
  @ApiResponse({ status: 201, type: PatientResponseDto })
  async create(
    @Body() dto: CreatePatientDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.patientsService.create(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get()
  @Permissions(Permission.PATIENT_READ)
  @ApiOperation({
    summary: 'List patients with pagination, search, and status filters',
  })
  async findAll(
    @Query() query: PatientQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.patientsService.findAll(query, currentUser.organizationId);
  }

  @Get(':id')
  @Permissions(Permission.PATIENT_READ)
  @ApiOperation({ summary: 'Get a single patient details' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.patientsService.findById(id, currentUser.organizationId);
  }

  @Put(':id')
  @Permissions(Permission.PATIENT_UPDATE)
  @ApiOperation({ summary: 'Update patient information' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.patientsService.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete(':id')
  @Permissions(Permission.PATIENT_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate/soft-delete patient record' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.patientsService.remove(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }
}
