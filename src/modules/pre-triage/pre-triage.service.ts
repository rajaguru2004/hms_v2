import { Injectable } from '@nestjs/common';
import { Prisma, PreTriage } from '@prisma/client';
import { PreTriageRepository } from './pre-triage.repository';
import { PatientsService } from '../patients/patients.service';
import { AuditService } from '../../audit/audit.service';
import { CreatePreTriageDto } from './dto/create-pre-triage.dto';
import { UpdatePreTriageDto } from './dto/update-pre-triage.dto';
import { PreTriageQueryDto } from './dto/pre-triage-query.dto';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class PreTriageService {
  constructor(
    private readonly preTriageRepository: PreTriageRepository,
    private readonly patientsService: PatientsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generates a unique Screening Number for pre-triage.
   * Format: SCR + YYYYMMDD + XXX (3 random digits)
   */
  private generateScreeningNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `SCR${date}${random}`;
  }

  /**
   * Create a new pre-triage screening.
   */
  async create(
    dto: CreatePreTriageDto,
    organizationId: string,
    userId?: string,
  ): Promise<PreTriage> {
    let retries = 3;
    let screening: PreTriage | null = null;

    while (retries > 0) {
      try {
        const screeningNumber = this.generateScreeningNumber();
        screening = await this.preTriageRepository.create({
          organization: { connect: { id: organizationId } },
          screeningNumber,
          firstName: dto.firstName,
          lastName: dto.lastName,
          age: dto.age,
          gender: dto.gender,
          phone: dto.phone,
          chiefComplaint: dto.chiefComplaint,
          briefHistory: dto.briefHistory,
          temperature: dto.temperature,
          bloodPressureSystolic: dto.bloodPressureSystolic,
          bloodPressureDiastolic: dto.bloodPressureDiastolic,
          pulseRate: dto.pulseRate,
          routedTo: dto.routedTo,
          status: 'screening',
          screenedBy: userId ? { connect: { id: userId } } : undefined,
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[] | undefined;
          if (target?.includes('screeningNumber')) {
            retries--;
            continue;
          }
        }
        throw error;
      }
    }

    if (!screening) {
      throw new ConflictException(
        'Failed to generate unique screening number after retries.',
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    // Audit log creation
    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'PreTriage',
      entityId: screening.id,
      newValues: {
        screeningNumber: screening.screeningNumber,
        firstName: screening.firstName,
        lastName: screening.lastName,
        status: screening.status,
      },
      metadata: { organizationId },
    });

    return screening;
  }

  /**
   * List screenings with filters and pagination.
   */
  async findAll(
    query: PreTriageQueryDto,
    organizationId: string,
  ): Promise<PaginatedResult<PreTriage>> {
    const where: Prisma.PreTriageWhereInput = {
      organizationId,
    };

    if (query.status && query.status !== 'all') {
      where.status = query.status;
    }

    if (query.search) {
      const searchLower = query.search.trim();
      where.OR = [
        { firstName: { contains: searchLower, mode: 'insensitive' } },
        { lastName: { contains: searchLower, mode: 'insensitive' } },
        { screeningNumber: { contains: searchLower, mode: 'insensitive' } },
        { phone: { contains: searchLower, mode: 'insensitive' } },
      ];
    }

    const orderByField =
      !query.orderBy || query.orderBy === 'createdAt'
        ? 'screenedAt'
        : query.orderBy;

    return this.preTriageRepository.paginate(where, {
      page: query.page,
      limit: query.limit,
      orderBy: {
        [orderByField]: query.orderDir ?? 'desc',
      },
      include: {
        screenedBy: { select: { fullName: true } },
      },
    });
  }

  /**
   * Get screening details by ID.
   */
  async findById(id: string, organizationId: string): Promise<PreTriage> {
    const screening = await this.preTriageRepository.findOne(
      { id, organizationId },
      {
        screenedBy: { select: { fullName: true } },
        patient: { select: { mrn: true, firstName: true, lastName: true } },
      },
    );

    if (!screening) {
      throw new NotFoundException(
        'Pre-triage screening not found or belongs to another organization',
        ErrorCodes.PRE_TRIAGE_NOT_FOUND,
      );
    }

    return screening;
  }

  /**
   * Update an existing pre-triage screening.
   */
  async update(
    id: string,
    dto: UpdatePreTriageDto,
    organizationId: string,
    userId?: string,
  ): Promise<PreTriage> {
    const existing = await this.findById(id, organizationId);

    const updateData: Prisma.PreTriageUpdateInput & { updatedBy?: string } = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      age: dto.age,
      gender: dto.gender,
      phone: dto.phone,
      chiefComplaint: dto.chiefComplaint,
      briefHistory: dto.briefHistory,
      temperature: dto.temperature,
      bloodPressureSystolic: dto.bloodPressureSystolic,
      bloodPressureDiastolic: dto.bloodPressureDiastolic,
      pulseRate: dto.pulseRate,
      routedTo: dto.routedTo,
      status: dto.status,
      patient: dto.patientId ? { connect: { id: dto.patientId } } : undefined,
      updatedBy: userId,
    };

    if (dto.status === 'routed' && existing.status !== 'routed') {
      updateData.routedAt = new Date();
      updateData.routedBy = userId ? { connect: { id: userId } } : undefined;
    }

    const updated = await this.preTriageRepository.update(id, updateData);

    // Audit log update
    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'PreTriage',
      entityId: id,
      oldValues: {
        status: existing.status,
        routedTo: existing.routedTo,
      },
      newValues: {
        status: updated.status,
        routedTo: updated.routedTo,
      },
      metadata: { organizationId },
    });

    return updated;
  }

  /**
   * Soft-delete a pre-triage screening.
   */
  async remove(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    await this.findById(id, organizationId);

    await this.preTriageRepository.softDelete(id, userId);

    // Audit log soft delete
    void this.auditService.log({
      userId,
      action: AuditAction.SOFT_DELETE,
      entityName: 'PreTriage',
      entityId: id,
      metadata: { organizationId },
    });
  }

  /**
   * Convert pre-triage screening to a Patient.
   */
  async convertToPatient(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<{ patientId: string; mrn: string }> {
    const screening = await this.findById(id, organizationId);

    if (screening.patientId) {
      throw new ConflictException(
        'Patient already registered from this screening',
        ErrorCodes.PRE_TRIAGE_ALREADY_CONVERTED,
      );
    }

    const dob = new Date(
      new Date().getFullYear() - (screening.age || 0),
      0,
      1,
    ).toISOString();
    const patientDto = {
      firstName: screening.firstName || 'Unknown',
      lastName: screening.lastName || 'Unknown',
      dateOfBirth: dob,
      gender: screening.gender || 'other',
      phonePrimary: screening.phone || undefined,
      notes: `Converted from screening ${screening.screeningNumber}. Complaint: ${screening.chiefComplaint}`,
    };

    const patient = await this.patientsService.create(
      patientDto,
      organizationId,
      userId,
    );

    // Update screening status and associate patient
    await this.update(
      id,
      {
        status: 'registered_as_patient',
        patientId: patient.id,
      },
      organizationId,
      userId,
    );

    // Audit log convert action
    void this.auditService.log({
      userId,
      action: AuditAction.CONVERT,
      entityName: 'PreTriage',
      entityId: id,
      metadata: {
        organizationId,
        patientId: patient.id,
        mrn: patient.mrn,
      },
      newValues: {
        status: 'registered_as_patient',
        patientId: patient.id,
      },
    });

    return {
      patientId: patient.id,
      mrn: patient.mrn,
    };
  }
}
