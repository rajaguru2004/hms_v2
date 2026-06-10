import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { PharmacyDrug, Prescription, PharmacySale } from '@prisma/client';
import { PharmacyDrugRepository } from './pharmacy-drug.repository';
import { PharmacyBatchRepository } from './pharmacy-batch.repository';
import { PrescriptionRepository } from './prescription.repository';
import { PharmacySaleRepository } from './pharmacy-sale.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  CreatePharmacyDrugDto,
  UpdatePharmacyDrugDto,
} from './dto/pharmacy-drug.dto';
import {
  CreatePrescriptionDto,
  UpdatePrescriptionDto,
} from './dto/prescription.dto';
import { CreatePharmacySaleDto } from './dto/pharmacy-sale.dto';
import {
  NotFoundException,
  AppException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

@Injectable()
export class PharmacyService {
  private readonly logger = new Logger(PharmacyService.name);

  constructor(
    private readonly pharmacyDrugRepository: PharmacyDrugRepository,
    private readonly pharmacyBatchRepository: PharmacyBatchRepository,
    private readonly prescriptionRepository: PrescriptionRepository,
    private readonly pharmacySaleRepository: PharmacySaleRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // =========================================================================
  // DRUGS
  // =========================================================================

  async getDrugs(
    organizationId: string,
    category?: string,
    search?: string,
  ): Promise<PharmacyDrug[]> {
    const where: Record<string, unknown> = { organizationId, isActive: true };
    if (category) {
      where.drugCategory = category;
    }
    if (search) {
      where.OR = [
        { drugName: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
        { drugCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.pharmacyDrugRepository.findMany(where, {
      orderBy: { drugName: 'asc' },
      include: {
        batches: {
          where: { status: 'active' },
          orderBy: { expiryDate: 'asc' },
          take: 1,
        },
      },
    });
  }

  async getDrugById(id: string, organizationId: string): Promise<PharmacyDrug> {
    const drug = await this.pharmacyDrugRepository.findOne({
      id,
      organizationId,
    });
    if (!drug) {
      throw new NotFoundException(
        `Pharmacy drug with ID ${id} not found`,
        ErrorCodes.DRUG_NOT_FOUND,
      );
    }
    return drug;
  }

  async createDrug(
    organizationId: string,
    dto: CreatePharmacyDrugDto,
    userId?: string,
  ): Promise<PharmacyDrug> {
    const drug = await this.pharmacyDrugRepository.create({
      organization: { connect: { id: organizationId } },
      ...dto,
      isActive: true,
      createdById: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'PharmacyDrug',
      entityId: drug.id,
      newValues: drug,
      metadata: { organizationId },
    });

    return drug;
  }

  async updateDrug(
    id: string,
    dto: UpdatePharmacyDrugDto,
    organizationId: string,
    userId?: string,
  ): Promise<PharmacyDrug> {
    const oldDrug = await this.getDrugById(id, organizationId);

    const drug = await this.pharmacyDrugRepository.update(id, {
      ...dto,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'PharmacyDrug',
      entityId: drug.id,
      oldValues: oldDrug,
      newValues: drug,
      metadata: { organizationId },
    });

    return drug;
  }

  // =========================================================================
  // PRESCRIPTIONS
  // =========================================================================

  async getPrescriptions(
    organizationId: string,
    status?: string,
  ): Promise<Prescription[]> {
    const where: Record<string, unknown> = { organizationId };
    if (status) {
      where.status = status;
    }

    return this.prescriptionRepository.findMany(where, {
      orderBy: { prescriptionDate: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            phonePrimary: true,
          },
        },
        doctor: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });
  }

  async getPrescriptionById(
    id: string,
    organizationId: string,
  ): Promise<Prescription> {
    const prescription = await this.prescriptionRepository.findOne({
      id,
      organizationId,
    });
    if (!prescription) {
      throw new NotFoundException(
        `Prescription with ID ${id} not found`,
        ErrorCodes.PRESCRIPTION_NOT_FOUND,
      );
    }
    return prescription;
  }

  async createPrescription(
    organizationId: string,
    dto: CreatePrescriptionDto,
    userId?: string,
  ): Promise<Prescription> {
    const prescription = await this.prescriptionRepository.create({
      organization: { connect: { id: organizationId } },
      patient: { connect: { id: dto.patientId } },
      doctor: { connect: { id: dto.doctorId } },
      ...(dto.consultationId && {
        consultation: { connect: { id: dto.consultationId } },
      }),
      items: JSON.stringify(dto.items),
      notes: dto.notes,
      status: 'pending',
      createdById: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Prescription',
      entityId: prescription.id,
      newValues: prescription,
      metadata: { organizationId },
    });

    // Fetch full object with patient/doctor details for compatibility response
    const fullPrescription = await this.prescriptionRepository.findOne(
      { id: prescription.id },
      {
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true },
        },
        doctor: {
          select: { id: true, fullName: true },
        },
      },
    );

    return fullPrescription || prescription;
  }

  async updatePrescription(
    id: string,
    dto: UpdatePrescriptionDto,
    organizationId: string,
    userId?: string,
  ): Promise<Prescription> {
    const oldPrescription = await this.getPrescriptionById(id, organizationId);

    const data: Record<string, unknown> = { ...dto };
    if (dto.items) {
      data.items = JSON.stringify(dto.items);
    }

    const prescription = await this.prescriptionRepository.update(id, {
      ...data,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Prescription',
      entityId: prescription.id,
      oldValues: oldPrescription,
      newValues: prescription,
      metadata: { organizationId },
    });

    return prescription;
  }

  // =========================================================================
  // SALES
  // =========================================================================

  async getSales(
    organizationId: string,
    date?: string,
  ): Promise<PharmacySale[]> {
    const where: Record<string, unknown> = { organizationId };
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      where.saleDate = { gte: start, lte: end };
    }

    return this.pharmacySaleRepository.findMany(where, {
      orderBy: { saleDate: 'desc' },
      include: {
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async getSaleById(id: string, organizationId: string): Promise<PharmacySale> {
    const sale = await this.pharmacySaleRepository.findOne({
      id,
      organizationId,
    });
    if (!sale) {
      throw new NotFoundException(
        `Pharmacy sale with ID ${id} not found`,
        ErrorCodes.SALE_NOT_FOUND,
      );
    }
    return sale;
  }

  async createSale(
    organizationId: string,
    dto: CreatePharmacySaleDto,
    userId?: string,
  ): Promise<PharmacySale> {
    // 1. Calculate totals
    const subtotal = dto.items.reduce((sum, item) => sum + item.total, 0);
    const receiptNumber = `RCP${Date.now()}`;

    // 2. Stock level validations
    for (const item of dto.items) {
      const drug = await this.pharmacyDrugRepository.findOne({
        id: item.drugId,
        organizationId,
      });
      if (!drug) {
        throw new NotFoundException(
          `Drug with ID ${item.drugId} not found in inventory`,
          ErrorCodes.DRUG_NOT_FOUND,
        );
      }
      if (drug.quantityInStock < item.quantity) {
        throw new AppException(
          `Insufficient stock for drug ${drug.drugName}. Available: ${drug.quantityInStock}, Requested: ${item.quantity}`,
          ErrorCodes.INSUFFICIENT_STOCK,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 3. Perform sale and update stock in a transaction
    const sale = await this.prisma.$transaction(async (tx) => {
      // Create sale record
      const createdSale = await tx.pharmacySale.create({
        data: {
          organizationId,
          patientId: dto.patientId,
          prescriptionId: dto.prescriptionId,
          servedById: userId,
          saleDate: new Date(),
          saleType: dto.prescriptionId ? 'prescription' : 'otc',
          items: JSON.stringify(dto.items),
          subtotal,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: subtotal,
          paymentStatus: dto.paymentStatus || 'pending',
          paymentMethod: dto.paymentMethod,
          amountPaid: dto.paymentStatus === 'paid' ? subtotal : 0,
          amountDue: dto.paymentStatus === 'paid' ? 0 : subtotal,
          receiptNumber,
          createdById: userId,
        },
      });

      // Update drug quantities
      for (const item of dto.items) {
        await tx.pharmacyDrug.update({
          where: { id: item.drugId },
          data: { quantityInStock: { decrement: item.quantity } },
        });
      }

      // Update prescription status to fully_dispensed if applicable
      if (dto.prescriptionId) {
        await tx.prescription.update({
          where: { id: dto.prescriptionId },
          data: {
            status: 'fully_dispensed',
            dispensedById: userId,
            dispensedAt: new Date(),
          },
        });
      }

      return createdSale;
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'PharmacySale',
      entityId: sale.id,
      newValues: sale,
      metadata: { organizationId },
    });

    return sale;
  }

  // =========================================================================
  // STATS
  // =========================================================================

  async getStats(organizationId: string) {
    const today = new Date();
    const todayStart = new Date(today.setHours(0, 0, 0, 0));
    const todayEnd = new Date(today.setHours(23, 59, 59, 999));

    const [
      totalDrugs,
      lowStock,
      outOfStock,
      pendingPrescriptions,
      todaySalesAgg,
    ] = await Promise.all([
      this.pharmacyDrugRepository.count({ organizationId, isActive: true }),
      this.prisma.pharmacyDrug.count({
        where: {
          organizationId,
          isActive: true,
          quantityInStock: {
            lte: this.prisma.pharmacyDrug.fields.reorderLevel,
          },
        },
      }),
      this.pharmacyDrugRepository.count({
        organizationId,
        isActive: true,
        quantityInStock: 0,
      }),
      this.prescriptionRepository.count({ organizationId, status: 'pending' }),
      this.prisma.pharmacySale.aggregate({
        where: { organizationId, saleDate: { gte: todayStart, lte: todayEnd } },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      totalDrugs,
      lowStock,
      outOfStock,
      pendingPrescriptions,
      todaySales: todaySalesAgg._sum.totalAmount || 0,
    };
  }
}
