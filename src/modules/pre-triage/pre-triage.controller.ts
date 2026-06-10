import {
  Controller,
  Get,
  Post,
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
import { PreTriageService } from './pre-triage.service';
import { CreatePreTriageDto } from './dto/create-pre-triage.dto';
import { UpdatePreTriageDto } from './dto/update-pre-triage.dto';
import { PreTriageQueryDto } from './dto/pre-triage-query.dto';
import { PreTriageResponseDto } from './dto/pre-triage-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('PreTriage')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('pre-triage')
export class PreTriageController {
  constructor(private readonly preTriageService: PreTriageService) {}

  @Post()
  @Permissions(Permission.PRE_TRIAGE_CREATE)
  @ApiOperation({ summary: 'Create a new pre-triage screening record' })
  @ApiResponse({ status: 201, type: PreTriageResponseDto })
  async create(
    @Body() dto: CreatePreTriageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<any> {
    return this.preTriageService.create(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get()
  @Permissions(Permission.PRE_TRIAGE_READ)
  @ApiOperation({
    summary: 'List pre-triage screenings with filters and pagination',
  })
  async findAll(
    @Query() query: PreTriageQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<any> {
    return this.preTriageService.findAll(query, currentUser.organizationId);
  }

  @Get(':id')
  @Permissions(Permission.PRE_TRIAGE_READ)
  @ApiOperation({ summary: 'Get details of a single pre-triage screening' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: PreTriageResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<any> {
    return this.preTriageService.findById(id, currentUser.organizationId);
  }

  @Patch(':id')
  @Permissions(Permission.PRE_TRIAGE_UPDATE)
  @ApiOperation({ summary: 'Update an existing pre-triage screening' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: PreTriageResponseDto })
  async updatePatch(
    @Param('id') id: string,
    @Body() dto: UpdatePreTriageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<any> {
    return this.preTriageService.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete(':id')
  @Permissions(Permission.PRE_TRIAGE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a pre-triage screening' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.preTriageService.remove(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Post(':id/convert')
  @Permissions(Permission.PRE_TRIAGE_UPDATE, Permission.PATIENT_CREATE)
  @ApiOperation({ summary: 'Convert pre-triage screening to a Patient record' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async convertToPatient(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<any> {
    return this.preTriageService.convertToPatient(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }
}
