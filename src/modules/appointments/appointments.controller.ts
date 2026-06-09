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
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentQueryDto } from './dto/appointment-query.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @Permissions(Permission.APPOINTMENT_CREATE)
  @ApiOperation({ summary: 'Schedule a new appointment' })
  @ApiResponse({ status: 201, type: AppointmentResponseDto })
  async create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentsService.create(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get()
  @Permissions(Permission.APPOINTMENT_READ)
  @ApiOperation({
    summary: 'List appointments with pagination and filters',
  })
  async findAll(
    @Query() query: AppointmentQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentsService.findAll(query, currentUser.organizationId);
  }

  @Get(':id')
  @Permissions(Permission.APPOINTMENT_READ)
  @ApiOperation({ summary: 'Get details of a single appointment' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AppointmentResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentsService.findById(id, currentUser.organizationId);
  }

  @Put(':id')
  @Patch(':id')
  @Permissions(Permission.APPOINTMENT_UPDATE)
  @ApiOperation({ summary: 'Update appointment details or status' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AppointmentResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentsService.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete(':id')
  @Permissions(Permission.APPOINTMENT_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel/soft-delete appointment record' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.appointmentsService.remove(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }
}
