import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
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
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import { ConsultationQueryDto } from './dto/consultation-query.dto';
import { ConsultationResponseDto } from './dto/consultation-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('Consultations')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  @Post()
  @Permissions(Permission.CONSULTATION_CREATE)
  @ApiOperation({ summary: 'Create a new clinical consultation record' })
  @ApiResponse({ status: 201, type: ConsultationResponseDto })
  async create(
    @Body() dto: CreateConsultationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.consultationsService.create(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get()
  @Permissions(Permission.CONSULTATION_READ)
  @ApiOperation({ summary: 'List consultations with filters and pagination' })
  async findAll(
    @Query() query: ConsultationQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.consultationsService.findAll(query, currentUser.organizationId);
  }

  @Get(':id')
  @Permissions(Permission.CONSULTATION_READ)
  @ApiOperation({ summary: 'Get details of a single consultation record' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: ConsultationResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.consultationsService.findById(id, currentUser.organizationId);
  }

  @Put(':id')
  @Permissions(Permission.CONSULTATION_UPDATE)
  @ApiOperation({ summary: 'Update an existing consultation record via PUT' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: ConsultationResponseDto })
  async updatePut(
    @Param('id') id: string,
    @Body() dto: UpdateConsultationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.consultationsService.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch(':id')
  @Permissions(Permission.CONSULTATION_UPDATE)
  @ApiOperation({ summary: 'Update an existing consultation record via PATCH' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: ConsultationResponseDto })
  async updatePatch(
    @Param('id') id: string,
    @Body() dto: UpdateConsultationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.consultationsService.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete(':id')
  @Permissions(Permission.CONSULTATION_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a clinical consultation record' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.consultationsService.remove(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }
}
