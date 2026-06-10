import { Injectable } from '@nestjs/common';
import { Consultation, Prisma } from '@prisma/client';
import { ConsultationRepository } from './consultations.repository';
import { PatientsService } from '../patients/patients.service';
import { UserService } from '../users/user.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import { ConsultationQueryDto } from './dto/consultation-query.dto';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ForbiddenException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class ConsultationsService {
  constructor(
    private readonly consultationRepository: ConsultationRepository,
    private readonly patientsService: PatientsService,
    private readonly userService: UserService,
    private readonly appointmentsService: AppointmentsService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly cacheService: AppCacheService,
  ) {}

  private readonly CACHE_PREFIX = 'consultation';

  /**
   * Create a new consultation.
   */
  async create(
    dto: CreateConsultationDto,
    organizationId: string,
    userId?: string,
  ): Promise<Consultation> {
    // 1. Verify patient exists in the organization
    await this.patientsService.findById(dto.patientId, organizationId);

    // 2. Verify doctor exists in the organization
    const doctor = await this.userService.findById(dto.doctorId);
    if (doctor.organizationId !== organizationId) {
      throw new ForbiddenException(
        'Doctor belongs to another organization',
        ErrorCodes.FORBIDDEN,
      );
    }

    // 3. Verify linked appointment if provided
    if (dto.appointmentId) {
      await this.appointmentsService.findById(
        dto.appointmentId,
        organizationId,
      );
    }

    const createData: Prisma.ConsultationCreateInput = {
      organization: { connect: { id: organizationId } },
      patient: { connect: { id: dto.patientId } },
      doctor: { connect: { id: dto.doctorId } },
      ...(dto.appointmentId && {
        appointment: { connect: { id: dto.appointmentId } },
      }),
      visitType: dto.visitType,
      temperature: dto.temperature,
      bloodPressureSystolic: dto.bloodPressureSystolic,
      bloodPressureDiastolic: dto.bloodPressureDiastolic,
      pulseRate: dto.pulseRate,
      respiratoryRate: dto.respiratoryRate,
      weight: dto.weight,
      height: dto.height,
      oxygenSaturation: dto.oxygenSaturation,
      chiefComplaint: dto.chiefComplaint,
      historyOfPresentIllness: dto.historyOfPresentIllness,
      physicalExamination: dto.physicalExamination,
      diagnosis: dto.diagnosis,
      icd10Codes: dto.icd10Codes ? JSON.stringify(dto.icd10Codes) : null,
      treatmentPlan: dto.treatmentPlan,
      followUpInstructions: dto.followUpInstructions,
      followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
      referredTo: dto.referredTo,
      referralReason: dto.referralReason,
      notes: dto.notes,
      createdById: userId,
    };

    // Use transaction if creating prescriptions or updating appointments to ensure atomic updates
    const consultation = await this.prisma.$transaction(async (tx) => {
      // Create consultation record using the delegate since repository does not share transaction context directly
      const created = await tx.consultation.create({
        data: createData,
      });

      // Create prescription if items provided
      if (dto.prescriptionItems && dto.prescriptionItems.length > 0) {
        await tx.prescription.create({
          data: {
            organizationId,
            patientId: dto.patientId,
            doctorId: dto.doctorId,
            consultationId: created.id,
            items: JSON.stringify(dto.prescriptionItems),
            status: 'pending',
            createdById: userId,
          },
        });
      }

      // Update appointment status if linked
      if (dto.appointmentId) {
        await tx.appointment.update({
          where: { id: dto.appointmentId },
          data: {
            status: 'completed',
            completedAt: new Date(),
          },
        });
      }

      return created;
    });

    // Invalidate appointment cache if linked appointment updated
    if (dto.appointmentId) {
      await this.cacheService.del(
        AppCacheService.buildKey('appointment', dto.appointmentId),
      );
    }

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Consultation',
      entityId: consultation.id,
      newValues: {
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        visitDate: consultation.visitDate,
      },
      metadata: { organizationId },
    });

    return this.findById(consultation.id, organizationId);
  }

  /**
   * Find consultation by ID with cache read-through.
   */
  async findById(id: string, organizationId: string): Promise<Consultation> {
    const cacheKey = AppCacheService.buildKey(this.CACHE_PREFIX, id);

    const cached = await this.cacheService.get<Consultation>(cacheKey);
    if (cached && cached.organizationId === organizationId) {
      return cached;
    }

    const consultation = await this.consultationRepository.findOne(
      { id, organizationId },
      {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            middleName: true,
            lastName: true,
            phonePrimary: true,
            gender: true,
            dateOfBirth: true,
            bloodGroup: true,
          },
        },
        doctor: {
          select: {
            id: true,
            fullName: true,
            specialization: true,
          },
        },
        prescriptions: {
          orderBy: { prescriptionDate: 'desc' },
        },
        labOrders: {
          include: {
            results: {
              include: {
                test: true,
              },
            },
          },
        },
        radiologyOrders: {
          include: {
            exam: true,
            report: true,
          },
        },
      },
    );

    if (!consultation) {
      throw new NotFoundException(
        'Consultation not found or belongs to another organization',
        ErrorCodes.CONSULTATION_NOT_FOUND,
      );
    }

    await this.cacheService.set(cacheKey, consultation, 300);
    return consultation;
  }

  /**
   * List consultations with filters and pagination.
   */
  async findAll(
    query: ConsultationQueryDto,
    organizationId: string,
  ): Promise<PaginatedResult<Consultation>> {
    const where: Prisma.ConsultationWhereInput = {
      organizationId,
    };

    if (query.patientId) {
      where.patientId = query.patientId;
    }

    if (query.doctorId) {
      where.doctorId = query.doctorId;
    }

    if (query.date) {
      const targetDate = new Date(query.date);
      const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
      where.visitDate = { gte: startOfDay, lte: endOfDay };
    }

    return this.consultationRepository.paginate(where, {
      page: query.page,
      limit: query.limit,
      orderBy: { visitDate: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            middleName: true,
            lastName: true,
            phonePrimary: true,
            gender: true,
            dateOfBirth: true,
            bloodGroup: true,
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
   * Update consultation details.
   */
  async update(
    id: string,
    dto: UpdateConsultationDto,
    organizationId: string,
    userId?: string,
  ): Promise<Consultation> {
    const existing = await this.consultationRepository.findOne({
      id,
      organizationId,
    });

    if (!existing) {
      throw new NotFoundException(
        'Consultation not found or belongs to another organization',
        ErrorCodes.CONSULTATION_NOT_FOUND,
      );
    }

    const updateData: Prisma.ConsultationUpdateInput = {
      ...(dto.visitType !== undefined && { visitType: dto.visitType }),
      ...(dto.temperature !== undefined && { temperature: dto.temperature }),
      ...(dto.bloodPressureSystolic !== undefined && {
        bloodPressureSystolic: dto.bloodPressureSystolic,
      }),
      ...(dto.bloodPressureDiastolic !== undefined && {
        bloodPressureDiastolic: dto.bloodPressureDiastolic,
      }),
      ...(dto.pulseRate !== undefined && { pulseRate: dto.pulseRate }),
      ...(dto.respiratoryRate !== undefined && {
        respiratoryRate: dto.respiratoryRate,
      }),
      ...(dto.weight !== undefined && { weight: dto.weight }),
      ...(dto.height !== undefined && { height: dto.height }),
      ...(dto.oxygenSaturation !== undefined && {
        oxygenSaturation: dto.oxygenSaturation,
      }),
      ...(dto.chiefComplaint !== undefined && {
        chiefComplaint: dto.chiefComplaint,
      }),
      ...(dto.historyOfPresentIllness !== undefined && {
        historyOfPresentIllness: dto.historyOfPresentIllness,
      }),
      ...(dto.physicalExamination !== undefined && {
        physicalExamination: dto.physicalExamination,
      }),
      ...(dto.diagnosis !== undefined && { diagnosis: dto.diagnosis }),
      ...(dto.icd10Codes !== undefined && {
        icd10Codes: dto.icd10Codes ? JSON.stringify(dto.icd10Codes) : null,
      }),
      ...(dto.treatmentPlan !== undefined && {
        treatmentPlan: dto.treatmentPlan,
      }),
      ...(dto.followUpInstructions !== undefined && {
        followUpInstructions: dto.followUpInstructions,
      }),
      ...(dto.followUpDate !== undefined && {
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
      }),
      ...(dto.referredTo !== undefined && { referredTo: dto.referredTo }),
      ...(dto.referralReason !== undefined && {
        referralReason: dto.referralReason,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    const updated = await this.consultationRepository.update(id, updateData);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Consultation',
      entityId: id,
      oldValues: {
        diagnosis: existing.diagnosis,
        chiefComplaint: existing.chiefComplaint,
      },
      newValues: {
        diagnosis: updated.diagnosis,
        chiefComplaint: updated.chiefComplaint,
      },
      metadata: { organizationId },
    });

    return this.findById(id, organizationId);
  }

  /**
   * Soft delete consultation.
   */
  async remove(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    const existing = await this.consultationRepository.findOne({
      id,
      organizationId,
    });

    if (!existing) {
      throw new NotFoundException(
        'Consultation not found or belongs to another organization',
        ErrorCodes.CONSULTATION_NOT_FOUND,
      );
    }

    await this.consultationRepository.softDelete(id, userId);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.SOFT_DELETE,
      entityName: 'Consultation',
      entityId: id,
      metadata: { organizationId },
    });
  }
}
