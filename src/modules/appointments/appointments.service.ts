import { Injectable } from '@nestjs/common';
import { Appointment, Prisma } from '@prisma/client';
import { AppointmentRepository } from './appointments.repository';
import { PatientsService } from '../patients/patients.service';
import { UserService } from '../users/user.service';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentQueryDto } from './dto/appointment-query.dto';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly appointmentRepository: AppointmentRepository,
    private readonly patientsService: PatientsService,
    private readonly userService: UserService,
    private readonly auditService: AuditService,
    private readonly cacheService: AppCacheService,
  ) {}

  private readonly CACHE_PREFIX = 'appointment';

  /**
   * Schedule a new appointment.
   */
  async create(
    dto: CreateAppointmentDto,
    organizationId: string,
    userId?: string,
    options: { bookedByPatient?: boolean } = {},
  ): Promise<Appointment> {
    // 1. Verify patient exists in the same organization
    await this.patientsService.findById(dto.patientId, organizationId);

    // 2. Verify doctor exists in the same organization (if provided)
    if (dto.doctorId) {
      const doctor = await this.userService.findById(dto.doctorId);
      if (doctor.organizationId !== organizationId) {
        throw new ForbiddenException(
          'Doctor belongs to another organization',
          ErrorCodes.FORBIDDEN,
        );
      }
    }

    // 3. A booking a patient made for themselves is held to two rules a
    //    booking a receptionist made is not.
    //
    //    Both exist because there is nobody in the room to catch the mistake.
    //    A desk that double-books a clinic knows it is doing it — a clinic
    //    deliberately overbooks its morning all the time, and refusing that
    //    would be the app telling a hospital how to run its diary. A patient
    //    tapping a slot that a stale screen still shows as free does not know,
    //    and neither does anybody else until both of them arrive.
    if (options.bookedByPatient) {
      if (!dto.doctorId) {
        throw new BadRequestException(
          'Choose a clinician for this appointment.',
          ErrorCodes.VALIDATION_ERROR,
        );
      }

      // The DTO's ceiling is 480 minutes, which is a whole clinic day. That is
      // the right bound for a theatre list a surgeon books; it is not a thing
      // a patient may take from a diary, so their bookings are capped at an
      // hour and the value is otherwise theirs to send.
      dto.durationMinutes = Math.min(dto.durationMinutes ?? 30, 60);

      await this.assertSlotFree(
        dto.doctorId,
        dto.appointmentDate,
        dto.appointmentTime,
        organizationId,
      );
    }

    const createData: Prisma.AppointmentCreateInput = {
      organization: { connect: { id: organizationId } },
      patient: { connect: { id: dto.patientId } },
      ...(dto.doctorId && { doctor: { connect: { id: dto.doctorId } } }),
      appointmentDate: new Date(dto.appointmentDate),
      appointmentTime: dto.appointmentTime,
      durationMinutes: dto.durationMinutes ?? 30,
      appointmentType: dto.appointmentType,
      chiefComplaint: dto.chiefComplaint,
      notes: dto.notes,
      departmentId: dto.departmentId,
      status: 'scheduled',
      reminderSent: false,
      createdById: userId,
    };

    const appointment = await this.appointmentRepository.create(createData);

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Appointment',
      entityId: appointment.id,
      newValues: {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
      },
      metadata: { organizationId },
    });

    // Return populated appointment
    return this.findById(appointment.id, organizationId);
  }

  /**
   * The clinicians a booking can be made with.
   *
   * A name and a specialism, which is what a picker shows. Delegated to
   * `UserService.findStaff` rather than re-querying so that "who can hold a
   * clinic" has one answer: the staff picker on the console and the booking
   * screen on a patient's phone offering different lists is the kind of
   * difference nobody notices until somebody is booked with a clinician who
   * left.
   */
  async bookableDoctors(organizationId: string) {
    const staff = await this.userService.findStaff(organizationId, 'DOCTOR');
    return staff.map((doctor) => ({
      id: doctor.id,
      fullName: doctor.fullName,
      specialization: doctor.specialization,
    }));
  }

  /**
   * What is already booked in one clinician's day.
   *
   * Times and lengths only. The caller may be a patient, so the rows carry
   * nothing about who holds the slot — a booking screen needs to know that
   * 10:20 is gone, not who is in it.
   *
   * Cancelled bookings are left out: the slot they were holding is free
   * again, and showing it as taken would shrink a clinic's day every time
   * somebody rang to cancel. `no_show` and `rescheduled` stay in — the first
   * is a slot that was consumed, and the second is a row the reschedule left
   * behind pointing at a time that genuinely passed.
   */
  async availability(
    doctorId: string,
    date: string,
    organizationId: string,
  ): Promise<{
    doctorId: string;
    date: string;
    taken: { appointmentTime: string; durationMinutes: number }[];
  }> {
    const rows = await this.appointmentRepository.findMany(
      {
        organizationId,
        doctorId,
        appointmentDate: dayWindow(date),
        status: { not: 'cancelled' },
      },
      { orderBy: { appointmentTime: 'asc' } },
    );

    return {
      doctorId,
      date,
      taken: rows.map((row) => ({
        appointmentTime: row.appointmentTime,
        durationMinutes: row.durationMinutes,
      })),
    };
  }

  /**
   * Refuses a slot somebody else already holds.
   *
   * Compared on the start time rather than on the interval, deliberately.
   * Overlap would be the more thorough test and it is the wrong one here: a
   * clinic whose diary is cut into twenty-minute slots books a forty-minute
   * appointment across two of them on purpose, and an overlap test would
   * refuse the second half of a booking the desk made itself. What a patient
   * must not be able to do is take a start time that is already taken, which
   * is exactly what the grid on their screen offers them.
   */
  private async assertSlotFree(
    doctorId: string,
    date: string,
    time: string,
    organizationId: string,
  ): Promise<void> {
    const clash = await this.appointmentRepository.findOne({
      organizationId,
      doctorId,
      appointmentDate: dayWindow(date),
      appointmentTime: time,
      status: { not: 'cancelled' },
    });

    if (clash) {
      throw new ConflictException(
        'That time has just been taken. Please choose another.',
        ErrorCodes.APPOINTMENT_CONFLICT,
      );
    }
  }

  /**
   * Find appointment by ID with read-through cache.
   */
  async findById(id: string, organizationId: string): Promise<Appointment> {
    const cacheKey = AppCacheService.buildKey(this.CACHE_PREFIX, id);

    // Read-through cache
    const cached = await this.cacheService.get<Appointment>(cacheKey);
    if (cached && cached.organizationId === organizationId) {
      return cached;
    }

    const appointment = await this.appointmentRepository.findOne(
      { id, organizationId },
      {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            phonePrimary: true,
            gender: true,
            dateOfBirth: true,
          },
        },
        doctor: {
          select: {
            id: true,
            fullName: true,
            specialization: true,
          },
        },
        consultations: true,
      },
    );

    if (!appointment) {
      throw new NotFoundException(
        'Appointment not found or belongs to another organization',
        ErrorCodes.APPOINTMENT_NOT_FOUND,
      );
    }

    await this.cacheService.set(cacheKey, appointment, 300);
    return appointment;
  }

  /**
   * List appointments with filters and pagination.
   */
  async findAll(
    query: AppointmentQueryDto,
    organizationId: string,
  ): Promise<PaginatedResult<Appointment>> {
    const where: Prisma.AppointmentWhereInput = {
      organizationId,
    };

    if (query.date) {
      where.appointmentDate = dayWindow(query.date);
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.doctorId) {
      where.doctorId = query.doctorId;
    }

    if (query.patientId) {
      where.patientId = query.patientId;
    }

    if (query.search) {
      // Same shape as LaboratoryService.getOrders: one nested patient OR, so
      // the mobile app's single search box reaches name and MRN alike.
      where.patient = {
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { mrn: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    return this.appointmentRepository.paginate(where, {
      page: query.page,
      limit: query.limit,
      orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            phonePrimary: true,
            gender: true,
            dateOfBirth: true,
          },
        },
        doctor: {
          select: {
            id: true,
            fullName: true,
            specialization: true,
          },
        },
      },
    });
  }

  /**
   * Update appointment details and status with auto-timestamps.
   */
  async update(
    id: string,
    dto: UpdateAppointmentDto,
    organizationId: string,
    userId?: string,
  ): Promise<Appointment> {
    const existing = await this.appointmentRepository.findOne({
      id,
      organizationId,
    });

    if (!existing) {
      throw new NotFoundException(
        'Appointment not found or belongs to another organization',
        ErrorCodes.APPOINTMENT_NOT_FOUND,
      );
    }

    // Verify doctor (if updated)
    if (dto.doctorId) {
      const doctor = await this.userService.findById(dto.doctorId);
      if (doctor.organizationId !== organizationId) {
        throw new ForbiddenException(
          'Doctor belongs to another organization',
          ErrorCodes.FORBIDDEN,
        );
      }
    }

    const updateData: Prisma.AppointmentUpdateInput = {
      ...(dto.appointmentDate && {
        appointmentDate: new Date(dto.appointmentDate),
      }),
      ...(dto.appointmentTime && { appointmentTime: dto.appointmentTime }),
      ...(dto.durationMinutes !== undefined && {
        durationMinutes: dto.durationMinutes,
      }),
      ...(dto.appointmentType !== undefined && {
        appointmentType: dto.appointmentType,
      }),
      ...(dto.chiefComplaint !== undefined && {
        chiefComplaint: dto.chiefComplaint,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.cancellationReason !== undefined && {
        cancellationReason: dto.cancellationReason,
      }),
      ...(dto.consultationNotes !== undefined && {
        consultationNotes: dto.consultationNotes,
      }),
      ...(dto.reminderSent !== undefined && { reminderSent: dto.reminderSent }),
    };

    // Auto status timestamps
    if (dto.status) {
      if (dto.status === 'checked_in') {
        updateData.checkedInAt = new Date();
        if (userId) {
          updateData.checkedInBy = { connect: { id: userId } };
        }
      } else if (dto.status === 'in_progress') {
        updateData.startedAt = new Date();
      } else if (dto.status === 'completed') {
        updateData.completedAt = new Date();
      } else if (dto.status === 'cancelled' || dto.status === 'no_show') {
        updateData.cancelledAt = new Date();
        if (userId) {
          updateData.cancelledById = userId;
        }
      }
    }

    // Auto reminder timestamp
    if (dto.reminderSent === true) {
      updateData.reminderSentAt = new Date();
    }

    const updated = await this.appointmentRepository.update(id, updateData);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Appointment',
      entityId: id,
      oldValues: {
        status: existing.status,
        appointmentDate: existing.appointmentDate,
        appointmentTime: existing.appointmentTime,
      },
      newValues: {
        status: updated.status,
        appointmentDate: updated.appointmentDate,
        appointmentTime: updated.appointmentTime,
      },
      metadata: { organizationId },
    });

    return this.findById(id, organizationId);
  }

  /**
   * Soft delete appointment.
   */
  async remove(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    const existing = await this.appointmentRepository.findOne({
      id,
      organizationId,
    });

    if (!existing) {
      throw new NotFoundException(
        'Appointment not found or belongs to another organization',
        ErrorCodes.APPOINTMENT_NOT_FOUND,
      );
    }

    await this.appointmentRepository.softDelete(id, userId);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.SOFT_DELETE,
      entityName: 'Appointment',
      entityId: id,
      metadata: { organizationId },
    });
  }
}

/**
 * One calendar day, as a range the date column can be compared against.
 *
 * `appointmentDate` is a timestamp holding a day, so a booking stored at
 * midnight and one stored at midday are both "the tenth" and an equality test
 * finds only the first. Written once and shared by the listing and the
 * availability read: two ways of deciding which bookings are on a day is two
 * answers to "is this slot free".
 */
function dayWindow(date: string): { gte: Date; lte: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { gte: start, lte: end };
}
