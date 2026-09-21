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
import { AppointmentAvailabilityQueryDto } from './dto/appointment-availability.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { patientScopeFor } from '../../common/guards/patient-self.guard';
import { NotFoundException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
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
    // A patient books for themselves and for nobody else.
    //
    // The same rule the listing below applies, on the way in rather than on
    // the way out — and it is the one that matters more: `patientId` is a
    // required key on the create DTO, so before this line a portal account
    // could put somebody else's id in the body and write a booking onto their
    // chart. Overwritten rather than compared, for the reason
    // `PatientSelfGuard` documents: refusing a foreign id and accepting an own
    // one answers differently, and different answers enumerate the register.
    const scope = patientScopeFor(currentUser);
    if (scope) dto.patientId = scope;

    return this.appointmentsService.create(
      dto,
      currentUser.organizationId,
      currentUser.id,
      { bookedByPatient: scope !== undefined },
    );
  }

  /**
   * The clinicians a booking can be made with.
   *
   * `GET /users/staff?role=DOCTOR` is the staff answer to this question and it
   * is gated on `PATIENT_READ` — which a portal account deliberately does not
   * hold, because holding it would open the whole register. So a patient
   * choosing who to see had no route to ask, and a booking screen with an
   * empty picker is a screen that cannot be used.
   *
   * Gated on `APPOINTMENT_CREATE`: whoever may make a booking may see who the
   * booking can be with, and nothing more than a name and a specialism comes
   * back.
   *
   * Declared above `@Get(':id')` on purpose. Nest matches in declaration
   * order, so a literal registered after the parameterised route is swallowed
   * by it and this would arrive as an appointment whose id is "doctors".
   */
  @Get('doctors')
  @Permissions(Permission.APPOINTMENT_CREATE)
  @ApiOperation({ summary: 'Clinicians who can be booked, for a picker' })
  async findBookableDoctors(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.appointmentsService.bookableDoctors(currentUser.organizationId);
  }

  /**
   * What is already taken in one clinician's day.
   *
   * Answers times and lengths only — no patient, no complaint, nothing that
   * says who holds the slot — because the caller may be a patient, and "who
   * else is seeing this doctor at 10:20" is not a question the booking screen
   * needs answered to grey a button out.
   */
  @Get('availability')
  @Permissions(Permission.APPOINTMENT_CREATE)
  @ApiOperation({ summary: "Slots already taken in a clinician's day" })
  async availability(
    @Query() query: AppointmentAvailabilityQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentsService.availability(
      query.doctorId,
      query.date,
      currentUser.organizationId,
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
    // A patient sees their own appointments and nobody else's.
    //
    // The guard that protects the patient-scoped modules rewrites an id in the
    // URL, and a listing route has no id to rewrite — so this one answered with
    // the whole organisation. Signing in as a patient returned ten
    // appointments belonging to ten other patients, with their names on them.
    // The filter is applied here rather than trusted from the query, because a
    // client-supplied `patientId` is the thing being defended against.
    // Assigned onto the DTO rather than spread into a new object: the query
    // class carries `skip` and `take` as getters, and a spread copies the data
    // and leaves the behaviour behind.
    const scope = patientScopeFor(currentUser);
    if (scope) query.patientId = scope;

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
    const appointment = await this.appointmentsService.findById(
      id,
      currentUser.organizationId,
    );

    // Same rule as the listing, one record at a time. Answered as not-found
    // rather than forbidden: telling a patient an appointment exists but is
    // not theirs confirms another patient's appointment to them, which is the
    // thing being prevented.
    const scope = patientScopeFor(currentUser);
    if (scope && appointment?.patientId !== scope) {
      throw new NotFoundException(
        'Appointment not found',
        ErrorCodes.APPOINTMENT_NOT_FOUND,
      );
    }

    return appointment;
  }

  /**
   * Two handlers for one write, and they cannot be one.
   *
   * `@Put(':id')` and `@Patch(':id')` stacked on a single method **do not
   * register two routes.** Both decorators write `METHOD_METADATA` on the same
   * descriptor and the outer one wins, so only PUT was mapped and every PATCH
   * this API documents came back as Nest's own
   * `404 Cannot PATCH /api/appointments/:id` — a 404 from the router, before
   * any guard or service ran, which is why it never looked like a permissions
   * or a missing-record problem. The mobile app sends PATCH for this
   * collection (`Endpoints.appointments` carries no `updateVerb`), so
   * confirming, checking in, completing, cancelling and rescheduling a booking
   * were all silently impossible from the phone.
   *
   * `ConsultationsController` had it right all along: one handler per verb,
   * both delegating. Kept in that shape rather than collapsed into `@All`,
   * which would also swallow `GET :id` and `DELETE :id` depending on
   * declaration order.
   */
  @Put(':id')
  @Permissions(Permission.APPOINTMENT_UPDATE)
  @ApiOperation({ summary: 'Update appointment details or status via PUT' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AppointmentResponseDto })
  async updatePut(
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

  @Patch(':id')
  @Permissions(Permission.APPOINTMENT_UPDATE)
  @ApiOperation({ summary: 'Update appointment details or status via PATCH' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AppointmentResponseDto })
  async updatePatch(
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
