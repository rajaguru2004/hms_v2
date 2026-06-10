import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingServiceRepository } from './billing-service.repository';
import { InvoiceRepository } from './invoice.repository';
import { PaymentRepository } from './payment.repository';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingServiceRepository,
    InvoiceRepository,
    PaymentRepository,
  ],
  exports: [
    BillingService,
    BillingServiceRepository,
    InvoiceRepository,
    PaymentRepository,
  ],
})
export class BillingModule {}
