/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PharmacyService } from './pharmacy.service';
import { PharmacyDrugRepository } from './pharmacy-drug.repository';
import { PharmacyBatchRepository } from './pharmacy-batch.repository';
import { PrescriptionRepository } from './prescription.repository';
import { PharmacySaleRepository } from './pharmacy-sale.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PharmacyDrug, Prescription, PharmacySale } from '@prisma/client';
import {
  NotFoundException,
  AppException,
} from '../../common/exceptions/app.exception';

describe('PharmacyService', () => {
  let service: PharmacyService;
  let pharmacyDrugRepository: jest.Mocked<PharmacyDrugRepository>;
  let prescriptionRepository: jest.Mocked<PrescriptionRepository>;
  let pharmacySaleRepository: jest.Mocked<PharmacySaleRepository>;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;

  const mockDrugRecord: PharmacyDrug = {
    id: 'drug-1',
    organizationId: 'org-demo',
    drugName: 'Paracetamol',
    genericName: 'Acetaminophen',
    brandName: 'Panadol',
    drugCode: 'DRG001',
    drugCategory: 'analgesic',
    dosageForm: 'tablet',
    strength: '500mg',
    quantityInStock: 100,
    unitOfMeasure: 'tablet',
    reorderLevel: 10,
    maximumStockLevel: 500,
    costPrice: 2.0,
    sellingPrice: 3.5,
    markupPercentage: 75.0,
    storageLocation: 'Shelf A1',
    requiresPrescription: false,
    supplierName: 'Supplier A',
    supplierContact: '123456',
    description: 'Pain reliever',
    sideEffects: 'None',
    contraindications: 'Liver disease',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
  };

  const mockPrescriptionRecord: Prescription = {
    id: 'pres-1',
    organizationId: 'org-demo',
    patientId: 'pat-1',
    consultationId: 'cons-1',
    doctorId: 'doc-1',
    prescriptionDate: new Date(),
    items: JSON.stringify([
      {
        drugId: 'drug-1',
        drugName: 'Paracetamol',
        dosage: '500mg',
        frequency: '3 times daily',
        duration: '5 days',
        quantity: 15,
        instructions: 'After meals',
      },
    ]),
    status: 'pending',
    dispensedById: null,
    dispensedAt: null,
    notes: 'Take with warm water',
    isRefill: false,
    refillsAllowed: 0,
    refillsRemaining: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
  };

  const mockSaleRecord: PharmacySale = {
    id: 'sale-1',
    organizationId: 'org-demo',
    patientId: 'pat-1',
    prescriptionId: 'pres-1',
    servedById: 'user-1',
    saleDate: new Date(),
    saleType: 'prescription',
    items: JSON.stringify([
      {
        drugId: 'drug-1',
        drugName: 'Paracetamol',
        quantity: 15,
        unitPrice: 3.5,
        total: 52.5,
      },
    ]),
    subtotal: 52.5,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 52.5,
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    amountPaid: 52.5,
    amountDue: 0,
    receiptNumber: 'RCP123456',
    createdAt: new Date(),
    createdById: 'user-1',
  };

  beforeEach(async () => {
    const mockDrugRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockBatchRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockPrescriptionRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockSaleRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockPrisma = {
      $transaction: jest.fn(),
      pharmacySale: {
        create: jest.fn(),
      },
      pharmacyDrug: {
        update: jest.fn(),
        fields: {
          reorderLevel: 'reorderLevel',
        },
      },
      prescription: {
        update: jest.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockPrisma),
    );

    const mockAudit = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PharmacyService,
        { provide: PharmacyDrugRepository, useValue: mockDrugRepo },
        { provide: PharmacyBatchRepository, useValue: mockBatchRepo },
        { provide: PrescriptionRepository, useValue: mockPrescriptionRepo },
        { provide: PharmacySaleRepository, useValue: mockSaleRepo },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<PharmacyService>(PharmacyService);
    pharmacyDrugRepository = module.get(PharmacyDrugRepository);
    prescriptionRepository = module.get(PrescriptionRepository);
    pharmacySaleRepository = module.get(PharmacySaleRepository);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDrugs', () => {
    it('should query and return active drugs', async () => {
      pharmacyDrugRepository.findMany.mockResolvedValue([mockDrugRecord]);
      const result = await service.getDrugs(
        'org-demo',
        'analgesic',
        'Paracetamol',
      );
      expect(pharmacyDrugRepository.findMany).toHaveBeenCalledWith(
        {
          organizationId: 'org-demo',
          isActive: true,
          drugCategory: 'analgesic',
          OR: [
            { drugName: { contains: 'Paracetamol', mode: 'insensitive' } },
            { genericName: { contains: 'Paracetamol', mode: 'insensitive' } },
            { drugCode: { contains: 'Paracetamol', mode: 'insensitive' } },
          ],
        },
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockDrugRecord.id);
    });
  });

  describe('createDrug', () => {
    it('should create drug and log audit', async () => {
      pharmacyDrugRepository.create.mockResolvedValue(mockDrugRecord);
      const result = await service.createDrug(
        'org-demo',
        {
          drugName: 'Paracetamol',
          genericName: 'Acetaminophen',
        },
        'user-1',
      );
      expect(pharmacyDrugRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockDrugRecord.id);
    });
  });

  describe('updateDrug', () => {
    it('should update drug and log audit', async () => {
      pharmacyDrugRepository.findOne.mockResolvedValue(mockDrugRecord);
      pharmacyDrugRepository.update.mockResolvedValue({
        ...mockDrugRecord,
        sellingPrice: 4.0,
      });

      const result = await service.updateDrug(
        'drug-1',
        { sellingPrice: 4.0 },
        'org-demo',
        'user-1',
      );
      expect(pharmacyDrugRepository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.sellingPrice).toBe(4.0);
    });

    it('should throw NotFoundException if drug does not exist', async () => {
      pharmacyDrugRepository.findOne.mockResolvedValue(null);
      await expect(
        service.updateDrug(
          'drug-diff',
          { sellingPrice: 4.0 },
          'org-demo',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPrescriptions', () => {
    it('should query and return prescriptions', async () => {
      prescriptionRepository.findMany.mockResolvedValue([
        mockPrescriptionRecord,
      ]);
      const result = await service.getPrescriptions('org-demo', 'pending');
      expect(prescriptionRepository.findMany).toHaveBeenCalledWith(
        { organizationId: 'org-demo', status: 'pending' },
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockPrescriptionRecord.id);
    });
  });

  describe('createPrescription', () => {
    it('should create prescription, audit log, and return populated object', async () => {
      prescriptionRepository.create.mockResolvedValue(mockPrescriptionRecord);
      prescriptionRepository.findOne.mockResolvedValue(mockPrescriptionRecord);

      const result = await service.createPrescription(
        'org-demo',
        {
          patientId: 'pat-1',
          doctorId: 'doc-1',
          items: [
            {
              drugId: 'drug-1',
              drugName: 'Paracetamol',
              quantity: 15,
            },
          ],
        },
        'user-1',
      );

      expect(prescriptionRepository.create).toHaveBeenCalled();
      expect(prescriptionRepository.findOne).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockPrescriptionRecord.id);
    });
  });

  describe('getSales', () => {
    it('should query and return sales filtered by date', async () => {
      pharmacySaleRepository.findMany.mockResolvedValue([mockSaleRecord]);
      const result = await service.getSales('org-demo', '2026-06-10');
      expect(pharmacySaleRepository.findMany).toHaveBeenCalledWith(
        {
          organizationId: 'org-demo',
          saleDate: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockSaleRecord.id);
    });
  });

  describe('createSale', () => {
    it('should validate stock, perform transaction, and create pharmacy sale', async () => {
      pharmacyDrugRepository.findOne.mockResolvedValue(mockDrugRecord);
      (prismaService.pharmacySale.create as jest.Mock).mockResolvedValue(
        mockSaleRecord,
      );
      (prismaService.pharmacyDrug.update as jest.Mock).mockResolvedValue(
        mockDrugRecord,
      );
      (prismaService.prescription.update as jest.Mock).mockResolvedValue(
        mockPrescriptionRecord,
      );

      const result = await service.createSale(
        'org-demo',
        {
          patientId: 'pat-1',
          prescriptionId: 'pres-1',
          items: [
            {
              drugId: 'drug-1',
              drugName: 'Paracetamol',
              quantity: 15,
              unitPrice: 3.5,
              total: 52.5,
            },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
        },
        'user-1',
      );

      expect(pharmacyDrugRepository.findOne).toHaveBeenCalledWith({
        id: 'drug-1',
        organizationId: 'org-demo',
      });
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.pharmacySale.create).toHaveBeenCalled();
      expect(prismaService.pharmacyDrug.update).toHaveBeenCalled();
      expect(prismaService.prescription.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockSaleRecord.id);
    });

    it('should throw AppException if stock is insufficient', async () => {
      pharmacyDrugRepository.findOne.mockResolvedValue({
        ...mockDrugRecord,
        quantityInStock: 5,
      });

      await expect(
        service.createSale(
          'org-demo',
          {
            patientId: 'pat-1',
            items: [
              {
                drugId: 'drug-1',
                drugName: 'Paracetamol',
                quantity: 15,
                unitPrice: 3.5,
                total: 52.5,
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(AppException);
    });
  });
});
