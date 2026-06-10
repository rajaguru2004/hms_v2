import { Injectable } from '@nestjs/common';
import { Ward, Bed, Admission, Prisma } from '@prisma/client';
import { WardRepository } from './ward.repository';
import { BedRepository } from './bed.repository';
import { AdmissionRepository } from './admission.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { CreateWardDto, UpdateWardDto } from './dto/ward.dto';
import { CreateBedDto, UpdateBedDto } from './dto/bed.dto';
import { CreateAdmissionDto, UpdateAdmissionDto } from './dto/admission.dto';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

export interface InpatientStats {
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  todayAdmissions: number;
  todayDischarges: number;
  occupancyRate: number;
}

@Injectable()
export class InpatientService {
  constructor(
    private readonly wardRepository: WardRepository,
    private readonly bedRepository: BedRepository,
    private readonly admissionRepository: AdmissionRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly cacheService: AppCacheService,
  ) {}

  private readonly CACHE_PREFIX = 'inpatient';

  // =========================================================================
  // WARDS
  // =========================================================================

  async getWards(organizationId: string): Promise<any[]> {
    const wards = await this.wardRepository.findMany(
      { organizationId, isActive: true },
      {
        orderBy: { name: 'asc' },
        include: { beds: true },
      },
    );

    // Calculate occupancy for each ward
    return Promise.all(
      wards.map(async (ward) => {
        const occupiedBeds = await this.prisma.bed.count({
          where: { wardId: ward.id, status: 'occupied' },
        });
        return {
          ...ward,
          occupiedBeds,
          availableBeds: ward.capacity - occupiedBeds,
          occupancyRate:
            ward.capacity > 0 ? (occupiedBeds / ward.capacity) * 100 : 0,
        };
      }),
    );
  }

  async getWardById(id: string, organizationId: string): Promise<Ward> {
    const ward = await this.wardRepository.findOne({ id, organizationId });
    if (!ward) {
      throw new NotFoundException(
        'Ward not found or belongs to another organization',
        ErrorCodes.WARD_NOT_FOUND,
      );
    }
    return ward;
  }

  async createWard(
    dto: CreateWardDto,
    organizationId: string,
    userId?: string,
  ): Promise<Ward> {
    const ward = await this.wardRepository.create({
      organization: { connect: { id: organizationId } },
      name: dto.name,
      code: dto.code,
      type: dto.type,
      capacity: dto.capacity || 0,
      ...(dto.departmentId && {
        department: { connect: { id: dto.departmentId } },
      }),
      isActive: true,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Ward',
      entityId: ward.id,
      newValues: { name: ward.name, capacity: ward.capacity },
      metadata: { organizationId },
    });

    return ward;
  }

  async updateWard(
    id: string,
    dto: UpdateWardDto,
    organizationId: string,
    userId?: string,
  ): Promise<Ward> {
    const existing = await this.getWardById(id, organizationId);

    const updateData: Prisma.WardUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.capacity !== undefined && { capacity: dto.capacity }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.departmentId !== undefined && {
        department: dto.departmentId
          ? { connect: { id: dto.departmentId } }
          : { disconnect: true },
      }),
    };

    const updated = await this.wardRepository.update(id, updateData);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Ward',
      entityId: id,
      oldValues: {
        name: existing.name,
        capacity: existing.capacity,
        isActive: existing.isActive,
      },
      newValues: {
        name: updated.name,
        capacity: updated.capacity,
        isActive: updated.isActive,
      },
      metadata: { organizationId },
    });

    return updated;
  }

  // =========================================================================
  // BEDS
  // =========================================================================

  async getBeds(
    organizationId: string,
    wardId?: string,
    status?: string,
  ): Promise<Bed[]> {
    const where: Record<string, unknown> = { organizationId };
    if (wardId) where.wardId = wardId;
    if (status) where.status = status;

    return this.bedRepository.findMany(where, {
      orderBy: { bedNumber: 'asc' },
      include: { ward: true },
    });
  }

  async getBedById(id: string, organizationId: string): Promise<Bed> {
    const bed = await this.bedRepository.findOne({ id, organizationId });
    if (!bed) {
      throw new NotFoundException(
        'Bed not found or belongs to another organization',
        ErrorCodes.BED_NOT_FOUND,
      );
    }
    return bed;
  }

  async createBed(
    dto: CreateBedDto,
    organizationId: string,
    userId?: string,
  ): Promise<Bed> {
    // Verify ward exists and belongs to the organization
    await this.getWardById(dto.wardId, organizationId);

    const bed = await this.bedRepository.create({
      organization: { connect: { id: organizationId } },
      ward: { connect: { id: dto.wardId } },
      bedNumber: dto.bedNumber,
      type: dto.type,
      status: dto.status || 'available',
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Bed',
      entityId: bed.id,
      newValues: { bedNumber: bed.bedNumber, wardId: bed.wardId },
      metadata: { organizationId },
    });

    // Return bed including ward
    return this.bedRepository.findOne(
      { id: bed.id },
      { ward: true },
    ) as Promise<Bed>;
  }

  async updateBed(
    id: string,
    dto: UpdateBedDto,
    organizationId: string,
    userId?: string,
  ): Promise<Bed> {
    const existing = await this.getBedById(id, organizationId);

    if (dto.wardId) {
      await this.getWardById(dto.wardId, organizationId);
    }

    const updateData: Prisma.BedUpdateInput = {
      ...(dto.bedNumber !== undefined && { bedNumber: dto.bedNumber }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.currentPatientId !== undefined && {
        currentPatientId: dto.currentPatientId,
      }),
      ...(dto.wardId !== undefined && {
        ward: { connect: { id: dto.wardId } },
      }),
    };

    const updated = await this.bedRepository.update(id, updateData);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Bed',
      entityId: id,
      oldValues: {
        status: existing.status,
        currentPatientId: existing.currentPatientId,
      },
      newValues: {
        status: updated.status,
        currentPatientId: updated.currentPatientId,
      },
      metadata: { organizationId },
    });

    return updated;
  }

  // =========================================================================
  // ADMISSIONS
  // =========================================================================

  async getAdmissions(
    organizationId: string,
    status?: string,
  ): Promise<Admission[]> {
    const where: Record<string, unknown> = { organizationId };
    if (status) where.status = status;

    return this.admissionRepository.findMany(where, {
      orderBy: { admissionDate: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
            phonePrimary: true,
          },
        },
        bed: {
          include: { ward: true },
        },
      },
    });
  }

  async getAdmissionById(
    id: string,
    organizationId: string,
  ): Promise<Admission> {
    const admission = await this.admissionRepository.findOne({
      id,
      organizationId,
    });
    if (!admission) {
      throw new NotFoundException(
        'Admission not found or belongs to another organization',
        ErrorCodes.ADMISSION_NOT_FOUND,
      );
    }
    return admission;
  }

  async createAdmission(
    dto: CreateAdmissionDto,
    organizationId: string,
    userId?: string,
  ): Promise<Admission> {
    // Verify patient exists in organization
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, organizationId },
    });
    if (!patient) {
      throw new NotFoundException(
        'Patient not found or belongs to another organization',
        ErrorCodes.PATIENT_NOT_FOUND,
      );
    }

    if (dto.bedId) {
      const bed = await this.getBedById(dto.bedId, organizationId);
      if (bed.status !== 'available') {
        throw new ConflictException(
          'Bed is not available for admission',
          ErrorCodes.BED_NOT_AVAILABLE,
        );
      }
    }

    const createData: Prisma.AdmissionCreateInput = {
      organization: { connect: { id: organizationId } },
      patient: { connect: { id: dto.patientId } },
      ...(dto.bedId && { bed: { connect: { id: dto.bedId } } }),
      admissionType: dto.admissionType,
      admissionReason: dto.admissionReason,
      admittingDoctorId: dto.admittingDoctorId,
      attendingDoctorId: dto.attendingDoctorId,
      status: 'admitted',
    };

    const admission = await this.prisma.$transaction(async (tx) => {
      const created = await tx.admission.create({
        data: createData,
        include: {
          patient: {
            select: { id: true, mrn: true, firstName: true, lastName: true },
          },
          bed: {
            include: { ward: true },
          },
        },
      });

      if (dto.bedId) {
        await tx.bed.update({
          where: { id: dto.bedId },
          data: {
            status: 'occupied',
            currentPatientId: dto.patientId,
          },
        });
      }

      return created;
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Admission',
      entityId: admission.id,
      newValues: { patientId: admission.patientId, bedId: admission.bedId },
      metadata: { organizationId },
    });

    return admission;
  }

  async updateAdmission(
    id: string,
    dto: UpdateAdmissionDto,
    organizationId: string,
    userId?: string,
  ): Promise<Admission> {
    const existing = await this.getAdmissionById(id, organizationId);

    const updateData: Prisma.AdmissionUpdateInput = {
      ...(dto.admissionType !== undefined && {
        admissionType: dto.admissionType,
      }),
      ...(dto.admissionReason !== undefined && {
        admissionReason: dto.admissionReason,
      }),
      ...(dto.admittingDoctorId !== undefined && {
        admittingDoctorId: dto.admittingDoctorId,
      }),
      ...(dto.attendingDoctorId !== undefined && {
        attendingDoctorId: dto.attendingDoctorId,
      }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.dischargeReason !== undefined && {
        dischargeReason: dto.dischargeReason,
      }),
      ...(dto.dischargeSummary !== undefined && {
        dischargeSummary: dto.dischargeSummary,
      }),
      ...(dto.dischargeDoctorId !== undefined && {
        dischargeDoctorId: dto.dischargeDoctorId,
      }),
      ...(dto.followUpNotes !== undefined && {
        followUpNotes: dto.followUpNotes,
      }),
      ...(dto.dischargeDate !== undefined && {
        dischargeDate: dto.dischargeDate ? new Date(dto.dischargeDate) : null,
      }),
      ...(dto.followUpDate !== undefined && {
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
      }),
      ...(dto.patientId !== undefined && {
        patient: { connect: { id: dto.patientId } },
      }),
      ...(dto.bedId !== undefined && {
        bed: dto.bedId ? { connect: { id: dto.bedId } } : { disconnect: true },
      }),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      // Handle discharge updates and bed status releases
      if (dto.status === 'discharged' && existing.status !== 'discharged') {
        if (existing.bedId) {
          await tx.bed.update({
            where: { id: existing.bedId },
            data: {
              status: 'available',
              currentPatientId: null,
            },
          });
        }
        updateData.dischargeDate = new Date();
      }

      // If assigning a new bed or changing bed
      if (dto.bedId !== undefined && dto.bedId !== existing.bedId) {
        // Free old bed if existed
        if (existing.bedId) {
          await tx.bed.update({
            where: { id: existing.bedId },
            data: {
              status: 'available',
              currentPatientId: null,
            },
          });
        }

        // Occupy new bed if provided
        if (dto.bedId) {
          const newBed = await tx.bed.findFirst({
            where: { id: dto.bedId, organizationId },
          });
          if (!newBed) {
            throw new NotFoundException(
              'New bed not found',
              ErrorCodes.BED_NOT_FOUND,
            );
          }
          if (newBed.status !== 'available') {
            throw new ConflictException(
              'New bed is not available',
              ErrorCodes.BED_NOT_AVAILABLE,
            );
          }
          await tx.bed.update({
            where: { id: dto.bedId },
            data: {
              status: 'occupied',
              currentPatientId: dto.patientId || existing.patientId,
            },
          });
        }
      }

      return tx.admission.update({
        where: { id },
        data: updateData,
        include: {
          patient: {
            select: { id: true, mrn: true, firstName: true, lastName: true },
          },
          bed: {
            include: { ward: true },
          },
        },
      });
    });

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Admission',
      entityId: id,
      oldValues: { status: existing.status, bedId: existing.bedId },
      newValues: { status: updated.status, bedId: updated.bedId },
      metadata: { organizationId },
    });

    return updated;
  }

  // =========================================================================
  // STATS
  // =========================================================================

  async getStats(organizationId: string): Promise<InpatientStats> {
    const today = new Date();
    const todayStart = new Date(today.setHours(0, 0, 0, 0));
    const todayEnd = new Date(today.setHours(23, 59, 59, 999));

    const [
      totalBeds,
      occupiedBeds,
      availableBeds,
      todayAdmissions,
      todayDischarges,
    ] = await Promise.all([
      this.bedRepository.count({ organizationId }),
      this.bedRepository.count({ organizationId, status: 'occupied' }),
      this.bedRepository.count({ organizationId, status: 'available' }),
      this.admissionRepository.count({
        organizationId,
        admissionDate: { gte: todayStart, lte: todayEnd },
      }),
      this.admissionRepository.count({
        organizationId,
        status: 'discharged',
        dischargeDate: { gte: todayStart, lte: todayEnd },
      }),
    ]);

    return {
      totalBeds,
      occupiedBeds,
      availableBeds,
      todayAdmissions,
      todayDischarges,
      occupancyRate: totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0,
    };
  }
}
