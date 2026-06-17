/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { BillingServiceRepository } from './billing-service.repository';
import { InvoiceRepository } from './invoice.repository';
import { PaymentRepository } from './payment.repository';
import { AuditService } from '../../audit/audit.service';
import {
  BillingService as BillingServiceModel,
  Invoice,
  Payment,
} from '@prisma/client';
import { NotFoundException } from '../../common/exceptions/app.exception';

describe('BillingService', () => {
  let service: BillingService;
  let billingServiceRepository: jest.Mocked<BillingServiceRepository>;
  let invoiceRepository: jest.Mocked<InvoiceRepository>;
  let paymentRepository: jest.Mocked<PaymentRepository>;
  let auditService: jest.Mocked<AuditService>;

  const mockServiceRecord: BillingServiceModel = {
    id: 'srv-1',
    organizationId: 'org-demo',
    serviceName: 'Consultation',
    serviceCode: 'CNS-001',
    serviceCategory: 'consultation',
    department: 'General',
    unitPrice: 200.0,
    isTaxable: false,
    taxPercentage: 0,
    isCoveredByInsurance: true,
    insuranceCopayPercentage: null,
    description: 'General doctor consultation',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
  };

  const mockInvoiceRecord: Invoice = {
    id: 'inv-1',
    organizationId: 'org-demo',
    patientId: 'pat-1',
    consultationId: 'cons-1',
    invoiceNumber: 'INV123456789',
    invoiceDate: new Date(),
    dueDate: new Date(),
    items: JSON.stringify([
      {
        type: 'service',
        referenceId: 'srv-1',
        description: 'Consultation',
        quantity: 1,
        unitPrice: 200.0,
        total: 200.0,
      },
    ]),
    subtotal: 200.0,
    discountAmount: 0.0,
    discountPercentage: 0.0,
    taxAmount: 0.0,
    totalAmount: 200.0,
    paymentStatus: 'unpaid',
    amountPaid: 0.0,
    balanceDue: 200.0,
    insuranceClaimAmount: 0.0,
    insuranceClaimStatus: null,
    patientCopayAmount: 0.0,
    status: 'draft',
    notes: 'Test invoice',
    termsAndConditions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
  };

  const mockPaymentRecord: Payment = {
    id: 'pay-1',
    organizationId: 'org-demo',
    invoiceId: 'inv-1',
    patientId: 'pat-1',
    paymentDate: new Date(),
    receiptNumber: 'RCP123456789',
    amount: 200.0,
    paymentMethod: 'cash',
    paymentReference: null,
    cardLastFour: null,
    mobileMoneyProvider: null,
    bankName: null,
    chequeNumber: null,
    chequeDate: null,
    processedById: 'user-1',
    isRefund: false,
    refundReason: null,
    originalPaymentId: null,
    notes: 'Paid in cash',
    createdAt: new Date(),
    createdById: 'user-1',
  };

  beforeEach(async () => {
    const mockServiceRepo = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockInvoiceRepo = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      sumOutstandingBalance: jest.fn(),
    };

    const mockPaymentRepo = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      sumPaymentsForDay: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BillingServiceRepository, useValue: mockServiceRepo },
        { provide: InvoiceRepository, useValue: mockInvoiceRepo },
        { provide: PaymentRepository, useValue: mockPaymentRepo },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    billingServiceRepository = module.get(BillingServiceRepository);
    invoiceRepository = module.get(InvoiceRepository);
    paymentRepository = module.get(PaymentRepository);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getServices', () => {
    it('should return billing services', async () => {
      billingServiceRepository.findMany.mockResolvedValue([mockServiceRecord]);
      const result = await service.getServices('org-demo', 'consultation');
      expect(billingServiceRepository.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockServiceRecord.id);
    });
  });

  describe('getInvoices', () => {
    it('should return invoices', async () => {
      invoiceRepository.findMany.mockResolvedValue([mockInvoiceRecord]);
      const result = await service.getInvoices('org-demo', 'draft', 'pat-1');
      expect(invoiceRepository.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockInvoiceRecord.id);
    });
  });

  describe('getPayments', () => {
    it('should return payments', async () => {
      paymentRepository.findMany.mockResolvedValue([mockPaymentRecord]);
      const result = await service.getPayments('org-demo', 'inv-1');
      expect(paymentRepository.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockPaymentRecord.id);
    });
  });

  describe('getStats', () => {
    it('should calculate billing stats', async () => {
      paymentRepository.sumPaymentsForDay.mockResolvedValue(500.0);
      invoiceRepository.count.mockResolvedValue(2);
      invoiceRepository.sumOutstandingBalance.mockResolvedValue(1000.0);
      billingServiceRepository.count.mockResolvedValue(10);

      const result = await service.getStats('org-demo');
      expect(result.todayRevenue).toBe(500.0);
      expect(result.pendingInvoices).toBe(2);
      expect(result.collectedToday).toBe(500.0);
      expect(result.outstandingBalance).toBe(1000.0);
      expect(result.totalServices).toBe(10);
    });
  });

  describe('createService', () => {
    it('should create billing service', async () => {
      billingServiceRepository.create.mockResolvedValue(mockServiceRecord);
      const result = await service.createService(
        {
          serviceName: 'Consultation',
          unitPrice: 200.0,
        },
        'org-demo',
        'user-1',
      );
      expect(billingServiceRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockServiceRecord.id);
    });
  });

  describe('createInvoice', () => {
    it('should create invoice and log audit', async () => {
      invoiceRepository.create.mockResolvedValue(mockInvoiceRecord);
      invoiceRepository.findOne.mockResolvedValue(mockInvoiceRecord);
      const result = await service.createInvoice(
        {
          patientId: 'pat-1',
          items: [
            {
              type: 'service',
              description: 'Consultation',
              quantity: 1,
              unitPrice: 200.0,
              total: 200.0,
            },
          ],
        },
        'org-demo',
        'user-1',
      );
      expect(invoiceRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockInvoiceRecord.id);
    });
  });

  describe('createPayment', () => {
    it('should record payment, update invoice, and log audit', async () => {
      invoiceRepository.findOne.mockResolvedValue(mockInvoiceRecord);
      paymentRepository.create.mockResolvedValue(mockPaymentRecord);
      invoiceRepository.update.mockResolvedValue(mockInvoiceRecord);

      const result = await service.createPayment(
        {
          invoiceId: 'inv-1',
          amount: 200.0,
          paymentMethod: 'cash',
        },
        'org-demo',
        'user-1',
      );

      expect(invoiceRepository.findOne).toHaveBeenCalled();
      expect(paymentRepository.create).toHaveBeenCalled();
      expect(invoiceRepository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockPaymentRecord.id);
    });

    it('should throw NotFoundException if invoice not found', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createPayment(
          {
            invoiceId: 'inv-different',
            amount: 200.0,
            paymentMethod: 'cash',
          },
          'org-demo',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateInvoice', () => {
    it('should update invoice status and log audit', async () => {
      invoiceRepository.findOne.mockResolvedValue(mockInvoiceRecord);
      invoiceRepository.update.mockResolvedValue({
        ...mockInvoiceRecord,
        status: 'cancelled',
        cancelledAt: new Date(),
      });

      const result = await service.updateInvoice(
        'inv-1',
        { status: 'cancelled' },
        'org-demo',
        'user-1',
      );

      expect(invoiceRepository.findOne).toHaveBeenCalled();
      expect(invoiceRepository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.status).toBe('cancelled');
    });

    it('should throw NotFoundException if invoice not found', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateInvoice(
          'inv-different',
          { status: 'cancelled' },
          'org-demo',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateService', () => {
    it('should update billing service and log audit', async () => {
      billingServiceRepository.findOne.mockResolvedValue(mockServiceRecord);
      billingServiceRepository.update.mockResolvedValue({
        ...mockServiceRecord,
        unitPrice: 250.0,
      });

      const result = await service.updateService(
        'srv-1',
        { unitPrice: 250.0 },
        'org-demo',
        'user-1',
      );

      expect(billingServiceRepository.findOne).toHaveBeenCalled();
      expect(billingServiceRepository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.unitPrice).toBe(250.0);
    });

    it('should throw NotFoundException if service not found', async () => {
      billingServiceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateService(
          'srv-different',
          { unitPrice: 250.0 },
          'org-demo',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getInvoiceById', () => {
    it('should return invoice if found', async () => {
      invoiceRepository.findOne.mockResolvedValue(mockInvoiceRecord);
      const result = await service.getInvoiceById('inv-1', 'org-demo');
      expect(invoiceRepository.findOne).toHaveBeenCalledWith(
        { id: 'inv-1', organizationId: 'org-demo' },
        expect.any(Object),
      );
      expect(result).toEqual(mockInvoiceRecord);
    });

    it('should throw NotFoundException if invoice not found', async () => {
      invoiceRepository.findOne.mockResolvedValue(null);
      await expect(
        service.getInvoiceById('inv-different', 'org-demo'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPaymentById', () => {
    it('should return payment if found', async () => {
      paymentRepository.findOne.mockResolvedValue(mockPaymentRecord);
      const result = await service.getPaymentById('pay-1', 'org-demo');
      expect(paymentRepository.findOne).toHaveBeenCalledWith(
        { id: 'pay-1', organizationId: 'org-demo' },
        expect.any(Object),
      );
      expect(result).toEqual(mockPaymentRecord);
    });

    it('should throw NotFoundException if payment not found', async () => {
      paymentRepository.findOne.mockResolvedValue(null);
      await expect(
        service.getPaymentById('pay-different', 'org-demo'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
