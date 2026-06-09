import { Injectable } from '@nestjs/common';
import { Patient, Prisma } from '@prisma/client';
import { PatientRepository } from './patients.repository';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { PaginatedResult } from '../../common/types/paginated.type';

export interface MappedPatient extends Omit<
  Patient,
  'allergies' | 'chronicConditions' | 'currentMedications'
> {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly patientRepository: PatientRepository,
    private readonly auditService: AuditService,
    private readonly cacheService: AppCacheService,
  ) {}

  private readonly CACHE_PREFIX = 'patient';

  /**
   * Generates a unique Medical Record Number (MRN).
   */
  private generateMRN(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `MRN${date}${random}`;
  }

  /**
   * Maps database Patient model to API representation.
   * Parses JSON string arrays into TypeScript arrays.
   */
  private mapToResponse(patient: Patient): MappedPatient {
    return {
      ...patient,
      allergies: this.parseJsonArray(patient.allergies),
      chronicConditions: this.parseJsonArray(patient.chronicConditions),
      currentMedications: this.parseJsonArray(patient.currentMedications),
    };
  }

  private parseJsonArray(value: string | null): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Register a new patient.
   * Employs retry mechanism for auto-generated MRN collisions.
   */
  async create(
    dto: CreatePatientDto,
    organizationId: string,
    userId?: string,
  ): Promise<MappedPatient> {
    let retries = 3;
    let patient: Patient | null = null;

    while (retries > 0) {
      try {
        const mrn = this.generateMRN();
        const createData: Prisma.PatientCreateInput = {
          organization: { connect: { id: organizationId } },
          mrn,
          externalId: dto.externalId,
          firstName: dto.firstName,
          middleName: dto.middleName,
          lastName: dto.lastName,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          bloodGroup: dto.bloodGroup,
          phonePrimary: dto.phonePrimary,
          phoneSecondary: dto.phoneSecondary,
          email: dto.email || null,
          region: dto.region,
          zone: dto.zone,
          woreda: dto.woreda,
          kebele: dto.kebele,
          houseNumber: dto.houseNumber,
          addressDescription: dto.addressDescription,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          emergencyContactRelationship: dto.emergencyContactRelationship,
          allergies: dto.allergies ? JSON.stringify(dto.allergies) : null,
          chronicConditions: dto.chronicConditions
            ? JSON.stringify(dto.chronicConditions)
            : null,
          currentMedications: dto.currentMedications
            ? JSON.stringify(dto.currentMedications)
            : null,
          hasInsurance: dto.hasInsurance ?? false,
          insuranceProvider: dto.insuranceProvider,
          insuranceId: dto.insuranceId,
          insuranceExpiryDate: dto.insuranceExpiryDate
            ? new Date(dto.insuranceExpiryDate)
            : null,
          photoUrl: dto.photoUrl,
          maritalStatus: dto.maritalStatus,
          occupation: dto.occupation,
          educationLevel: dto.educationLevel,
          isVip: dto.isVip ?? false,
          notes: dto.notes,
          createdById: userId,
        };

        patient = await this.patientRepository.create(createData);
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[] | undefined;
          if (target?.includes('mrn')) {
            retries--;
            continue;
          }
        }
        throw error;
      }
    }

    if (!patient) {
      throw new ConflictException(
        'Failed to generate unique Medical Record Number after retries.',
        ErrorCodes.PATIENT_MRN_TAKEN,
      );
    }

    // Audit log patient registration
    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Patient',
      entityId: patient.id,
      newValues: {
        mrn: patient.mrn,
        firstName: patient.firstName,
        lastName: patient.lastName,
      },
      metadata: { organizationId },
    });

    return this.mapToResponse(patient);
  }

  /**
   * Find patient by ID. Read-through cache included.
   */
  async findById(id: string, organizationId: string): Promise<MappedPatient> {
    const cacheKey = AppCacheService.buildKey(this.CACHE_PREFIX, id);

    const cached = await this.cacheService.get<MappedPatient>(cacheKey);
    if (cached && cached.organizationId === organizationId) {
      return cached;
    }

    const patient = await this.patientRepository.findOne({
      id,
      organizationId,
    });
    if (!patient) {
      throw new NotFoundException(
        'Patient not found or belongs to another organization',
        ErrorCodes.PATIENT_NOT_FOUND,
      );
    }

    const mapped = this.mapToResponse(patient);
    await this.cacheService.set(cacheKey, mapped, 300);

    return mapped;
  }

  /**
   * List patients with pagination, search, and status filters.
   */
  async findAll(
    query: PatientQueryDto,
    organizationId: string,
  ): Promise<PaginatedResult<MappedPatient>> {
    const where: Prisma.PatientWhereInput = {
      organizationId,
    };

    if (query.status === 'active') {
      where.isActive = true;
    } else if (query.status === 'inactive') {
      where.isActive = false;
    }

    if (query.search) {
      const searchLower = query.search.trim();
      where.OR = [
        { firstName: { contains: searchLower, mode: 'insensitive' } },
        { lastName: { contains: searchLower, mode: 'insensitive' } },
        { mrn: { contains: searchLower, mode: 'insensitive' } },
        { phonePrimary: { contains: searchLower, mode: 'insensitive' } },
      ];
    }

    const result = await this.patientRepository.paginate(where, {
      page: query.page,
      limit: query.limit,
      orderBy: {
        [query.orderBy ?? 'createdAt']: query.orderDir ?? 'desc',
      },
    });

    return {
      ...result,
      data: result.data.map((p) => this.mapToResponse(p)),
    };
  }

  /**
   * Update patient profile.
   */
  async update(
    id: string,
    dto: UpdatePatientDto,
    organizationId: string,
    userId?: string,
  ): Promise<MappedPatient> {
    const existing = await this.patientRepository.findOne({
      id,
      organizationId,
    });
    if (!existing) {
      throw new NotFoundException(
        'Patient not found or belongs to another organization',
        ErrorCodes.PATIENT_NOT_FOUND,
      );
    }

    const updateData: Prisma.PatientUpdateInput & { updatedBy?: string } = {
      externalId: dto.externalId,
      firstName: dto.firstName,
      middleName: dto.middleName,
      lastName: dto.lastName,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      gender: dto.gender,
      bloodGroup: dto.bloodGroup,
      phonePrimary: dto.phonePrimary,
      phoneSecondary: dto.phoneSecondary,
      email: dto.email === '' ? null : dto.email,
      region: dto.region,
      zone: dto.zone,
      woreda: dto.woreda,
      kebele: dto.kebele,
      houseNumber: dto.houseNumber,
      addressDescription: dto.addressDescription,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
      emergencyContactRelationship: dto.emergencyContactRelationship,
      allergies: dto.allergies ? JSON.stringify(dto.allergies) : undefined,
      chronicConditions: dto.chronicConditions
        ? JSON.stringify(dto.chronicConditions)
        : undefined,
      currentMedications: dto.currentMedications
        ? JSON.stringify(dto.currentMedications)
        : undefined,
      hasInsurance: dto.hasInsurance,
      insuranceProvider: dto.insuranceProvider,
      insuranceId: dto.insuranceId,
      insuranceExpiryDate: dto.insuranceExpiryDate
        ? new Date(dto.insuranceExpiryDate)
        : undefined,
      photoUrl: dto.photoUrl,
      maritalStatus: dto.maritalStatus,
      occupation: dto.occupation,
      educationLevel: dto.educationLevel,
      isVip: dto.isVip,
      notes: dto.notes,
      isActive: dto.isActive,
      updatedById: userId,
      updatedBy: userId,
    };

    const updated = await this.patientRepository.update(id, updateData);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Patient',
      entityId: id,
      oldValues: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        isActive: existing.isActive,
      },
      newValues: {
        firstName: updated.firstName,
        lastName: updated.lastName,
        isActive: updated.isActive,
      },
      metadata: { organizationId },
    });

    return this.mapToResponse(updated);
  }

  /**
   * Soft delete patient.
   */
  async remove(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    const existing = await this.patientRepository.findOne({
      id,
      organizationId,
    });
    if (!existing) {
      throw new NotFoundException(
        'Patient not found or belongs to another organization',
        ErrorCodes.PATIENT_NOT_FOUND,
      );
    }

    await this.patientRepository.softDelete(id, userId);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit log deactivation
    void this.auditService.log({
      userId,
      action: AuditAction.SOFT_DELETE,
      entityName: 'Patient',
      entityId: id,
      metadata: { organizationId },
    });
  }
}
