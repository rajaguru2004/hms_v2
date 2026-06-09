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
      const targetDate = new Date(query.date);
      const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
      where.appointmentDate = { gte: startOfDay, lte: endOfDay };
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

    return this.appointmentRepository.paginate(where, {
      page: query.page,
      limit: query.limit,
      orderBy: [
        { appointmentDate: 'asc' },
        { appointmentTime: 'asc' },
      ],
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
      ...(dto.appointmentDate && { appointmentDate: new Date(dto.appointmentDate) }),
      ...(dto.appointmentTime && { appointmentTime: dto.appointmentTime }),
      ...(dto.durationMinutes !== undefined && { durationMinutes: dto.durationMinutes }),
      ...(dto.appointmentType !== undefined && { appointmentType: dto.appointmentType }),
      ...(dto.chiefComplaint !== undefined && { chiefComplaint: dto.chiefComplaint }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.cancellationReason !== undefined && { cancellationReason: dto.cancellationReason }),
      ...(dto.consultationNotes !== undefined && { consultationNotes: dto.consultationNotes }),
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
    await this.cacheService.del(AppCacheService.buildKey(this.CACHE_PREFIX, id));

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
    await this.cacheService.del(AppCacheService.buildKey(this.CACHE_PREFIX, id));

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
