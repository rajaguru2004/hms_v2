import { Injectable } from '@nestjs/common';
import {
  BillingService as BillingServiceModel,
  Invoice,
  Payment,
  Prisma,
} from '@prisma/client';
import { BillingServiceRepository } from './billing-service.repository';
import { InvoiceRepository } from './invoice.repository';
import { PaymentRepository } from './payment.repository';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import { NotFoundException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import {
  CreateBillingServiceDto,
  UpdateBillingServiceDto,
} from './dto/service.dto';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { CreatePaymentDto } from './dto/payment.dto';

@Injectable()
export class BillingService {
  constructor(
    private readonly billingServiceRepository: BillingServiceRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Get active billing services, ordered by category and name.
   */
  async getServices(
    organizationId: string,
    category?: string,
  ): Promise<BillingServiceModel[]> {
    const where: Record<string, unknown> = { organizationId, isActive: true };
    if (category) {
      where.serviceCategory = category;
    }
    return this.billingServiceRepository.findMany(where, {
      orderBy: [{ serviceCategory: 'asc' }, { serviceName: 'asc' }] as Array<
        Record<string, 'asc' | 'desc'>
      >,
    });
  }

  /**
   * Get invoices for an organization with optional filters, ordered by invoice date descending.
   */
  async getInvoices(
    organizationId: string,
    status?: string,
    patientId?: string,
  ): Promise<Invoice[]> {
    const where: Record<string, unknown> = { organizationId };
    if (status) {
      where.status = status;
    }
    if (patientId) {
      where.patientId = patientId;
    }
    return this.invoiceRepository.findMany(where, {
      orderBy: { invoiceDate: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            phonePrimary: true,
            hasInsurance: true,
            insuranceProvider: true,
          },
        },
        payments: true,
      },
    });
  }

  /**
   * Get payments for an organization with optional filters, ordered by payment date descending.
   */
  async getPayments(
    organizationId: string,
    invoiceId?: string,
  ): Promise<Payment[]> {
    const where: Record<string, unknown> = { organizationId };
    if (invoiceId) {
      where.invoiceId = invoiceId;
    }
    return this.paymentRepository.findMany(where, {
      orderBy: { paymentDate: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  /**
   * Get billing dashboard stats.
   */
  async getStats(organizationId: string): Promise<{
    todayRevenue: number;
    pendingInvoices: number;
    collectedToday: number;
    outstandingBalance: number;
    totalServices: number;
  }> {
    const today = new Date();
    const todayStart = new Date(today.setHours(0, 0, 0, 0));
    const todayEnd = new Date(today.setHours(23, 59, 59, 999));

    const [
      todayRevenue,
      pendingInvoices,
      collectedToday,
      outstandingBalance,
      totalServices,
    ] = await Promise.all([
      this.paymentRepository.sumPaymentsForDay(
        organizationId,
        todayStart,
        todayEnd,
      ),
      this.invoiceRepository.count({
        organizationId,
        paymentStatus: { in: ['unpaid', 'partially_paid'] },
      }),
      this.paymentRepository.sumPaymentsForDay(
        organizationId,
        todayStart,
        todayEnd,
      ),
      this.invoiceRepository.sumOutstandingBalance(organizationId),
      this.billingServiceRepository.count({ organizationId, isActive: true }),
    ]);

    return {
      todayRevenue,
      pendingInvoices,
      collectedToday,
      outstandingBalance,
      totalServices,
    };
  }

  /**
   * Create a new billing service.
   */
  async createService(
    dto: CreateBillingServiceDto,
    organizationId: string,
    userId?: string,
  ): Promise<BillingServiceModel> {
    const service = await this.billingServiceRepository.create({
      organization: { connect: { id: organizationId } },
      serviceName: dto.serviceName,
      serviceCode: dto.serviceCode,
      serviceCategory: dto.serviceCategory,
      department: dto.department,
      unitPrice: dto.unitPrice,
      isTaxable: dto.isTaxable ?? false,
      taxPercentage: dto.taxPercentage ?? 0,
      isCoveredByInsurance: dto.isCoveredByInsurance ?? true,
      insuranceCopayPercentage: dto.insuranceCopayPercentage,
      description: dto.description,
      isActive: true,
      createdById: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'BillingService',
      entityId: service.id,
      newValues: {
        serviceName: service.serviceName,
        unitPrice: service.unitPrice,
      },
      metadata: { organizationId },
    });

    return service;
  }

  /**
   * Create a new invoice.
   */
  async createInvoice(
    dto: CreateInvoiceDto,
    organizationId: string,
    userId?: string,
  ): Promise<Invoice> {
    const invoiceNumber = `INV${Date.now()}`;
    const subtotal = dto.items.reduce((sum, item) => sum + item.total, 0);
    const taxAmount = dto.items.reduce((sum, item) => sum + (item.tax ?? 0), 0);
    const discountAmount = dto.discountAmount ?? 0;
    const totalAmount = subtotal - discountAmount + taxAmount;

    const invoice = await this.invoiceRepository.create({
      organization: { connect: { id: organizationId } },
      patient: { connect: { id: dto.patientId } },
      consultation: dto.consultationId
        ? { connect: { id: dto.consultationId } }
        : undefined,
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      items: JSON.stringify(dto.items),
      subtotal,
      discountAmount,
      discountPercentage: dto.discountPercentage ?? 0,
      taxAmount,
      totalAmount,
      balanceDue: totalAmount,
      status: 'draft',
      paymentStatus: 'unpaid',
      notes: dto.notes,
      createdBy: userId ? { connect: { id: userId } } : undefined,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Invoice',
      entityId: invoice.id,
      newValues: {
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount,
      },
      metadata: { organizationId },
    });

    // Re-fetch to match inclusion from Next.js (patient details)
    const fetched = await this.invoiceRepository.findOne(
      { id: invoice.id },
      {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    );

    return fetched || invoice;
  }

  /**
   * Record a payment against an invoice.
   */
  async createPayment(
    dto: CreatePaymentDto,
    organizationId: string,
    userId?: string,
  ): Promise<Payment> {
    const invoice = await this.invoiceRepository.findOne({
      id: dto.invoiceId,
      organizationId,
    });

    if (!invoice) {
      throw new NotFoundException(
        'Invoice not found',
        ErrorCodes.INVOICE_NOT_FOUND,
      );
    }

    const receiptNumber = `RCP${Date.now()}`;
    const payment = await this.paymentRepository.create({
      organization: { connect: { id: organizationId } },
      invoice: { connect: { id: dto.invoiceId } },
      patient: dto.patientId ? { connect: { id: dto.patientId } } : undefined,
      amount: dto.amount,
      paymentMethod: dto.paymentMethod,
      paymentReference: dto.paymentReference,
      mobileMoneyProvider: dto.mobileMoneyProvider,
      bankName: dto.bankName,
      chequeNumber: dto.chequeNumber,
      receiptNumber,
      createdById: userId,
      processedBy: userId ? { connect: { id: userId } } : undefined,
    });

    const newAmountPaid = invoice.amountPaid + dto.amount;
    const paymentStatus =
      newAmountPaid >= invoice.totalAmount ? 'paid' : 'partially_paid';

    await this.invoiceRepository.update(dto.invoiceId, {
      amountPaid: newAmountPaid,
      balanceDue: invoice.totalAmount - newAmountPaid,
      paymentStatus,
      status: paymentStatus === 'paid' ? 'paid' : 'sent',
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Payment',
      entityId: payment.id,
      newValues: {
        receiptNumber: payment.receiptNumber,
        amount: payment.amount,
        invoiceId: payment.invoiceId,
      },
      metadata: { organizationId },
    });

    return payment;
  }

  /**
   * Update or cancel an invoice.
   */
  async updateInvoice(
    id: string,
    updates: UpdateInvoiceDto,
    organizationId: string,
    userId?: string,
  ): Promise<Invoice> {
    const existing = await this.invoiceRepository.findOne({
      id,
      organizationId,
    });
    if (!existing) {
      throw new NotFoundException(
        'Invoice not found',
        ErrorCodes.INVOICE_NOT_FOUND,
      );
    }

    const data: Prisma.InvoiceUpdateInput = { ...updates };
    if (updates.status === 'cancelled') {
      data.cancelledAt = new Date();
      data.cancelledBy = userId ? { connect: { id: userId } } : undefined;
    }

    const updated = await this.invoiceRepository.update(id, data);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Invoice',
      entityId: id,
      oldValues: {
        status: existing.status,
        paymentStatus: existing.paymentStatus,
      },
      newValues: {
        status: updated.status,
        paymentStatus: updated.paymentStatus,
      },
      metadata: { organizationId },
    });

    return updated;
  }

  /**
   * Update a billing service.
   */
  async updateService(
    id: string,
    updates: UpdateBillingServiceDto,
    organizationId: string,
    userId?: string,
  ): Promise<BillingServiceModel> {
    const existing = await this.billingServiceRepository.findOne({
      id,
      organizationId,
    });
    if (!existing) {
      throw new NotFoundException(
        'Billing service not found',
        ErrorCodes.BILLING_SERVICE_NOT_FOUND,
      );
    }

    const updated = await this.billingServiceRepository.update(id, updates);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'BillingService',
      entityId: id,
      oldValues: {
        serviceName: existing.serviceName,
        unitPrice: existing.unitPrice,
        isActive: existing.isActive,
      },
      newValues: {
        serviceName: updated.serviceName,
        unitPrice: updated.unitPrice,
        isActive: updated.isActive,
      },
      metadata: { organizationId },
    });

    return updated;
  }

  /**
   * Get single invoice by ID.
   */
  async getInvoiceById(id: string, organizationId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne(
      { id, organizationId },
      {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            phonePrimary: true,
            hasInsurance: true,
            insuranceProvider: true,
          },
        },
        payments: true,
      },
    );

    if (!invoice) {
      throw new NotFoundException(
        'Invoice not found',
        ErrorCodes.INVOICE_NOT_FOUND,
      );
    }

    return invoice;
  }

  /**
   * Get single payment transaction details by ID.
   */
  async getPaymentById(id: string, organizationId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne(
      { id, organizationId },
      {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
          },
        },
        invoice: true,
      },
    );

    if (!payment) {
      throw new NotFoundException(
        'Payment record not found',
        ErrorCodes.PAYMENT_NOT_FOUND,
      );
    }

    return payment;
  }
}
