/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';

describe('BillingController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Mock JwtAuthGuard prototype to bypass authentication globally
    jest
      .spyOn(JwtAuthGuard.prototype, 'canActivate')
      .mockImplementation((context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        req.user = {
          id: 'test-user-id',
          email: 'test@hms.local',
          roles: ['SUPER_ADMIN'],
          permissions: [],
          organizationId: 'org-demo',
        };
        return true;
      });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  beforeEach(async () => {
    // Set NODE_ENV to test to allow cleanDatabase to run
    process.env.NODE_ENV = 'test';
    await prisma.cleanDatabase();

    // Seed required Organization and Patient
    await prisma.organization.create({
      data: {
        id: 'org-demo',
        name: 'Demo Org',
        slug: 'demo-org',
      },
    });

    await prisma.user.create({
      data: {
        id: 'test-user-id',
        email: 'test@hms.local',
        fullName: 'Test User',
        organizationId: 'org-demo',
      },
    });

    await prisma.patient.create({
      data: {
        id: 'pat-demo',
        organizationId: 'org-demo',
        mrn: 'MRNDEMO12345',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'male',
        phonePrimary: '+251911000000',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create billing service, invoice, and record payment', async () => {
    // 1. Create a service catalog entry
    const createServiceRes = await request(app.getHttpServer())
      .post('/billing')
      .send({
        resource: 'service',
        serviceName: 'Consultation Fee',
        serviceCode: 'SRV-CONS',
        serviceCategory: 'consultation',
        unitPrice: 300.0,
        isTaxable: false,
      })
      .expect(201);

    expect(createServiceRes.body.success).toBe(true);
    expect(createServiceRes.body.message).toBe('Service created successfully');
    const serviceId = createServiceRes.body.data.id;
    expect(serviceId).toBeDefined();

    // 2. Query billing services via compatibility route
    const getServicesRes = await request(app.getHttpServer())
      .get('/billing?resource=services&category=consultation')
      .expect(200);

    expect(getServicesRes.body.success).toBe(true);
    expect(getServicesRes.body.data).toHaveLength(1);
    expect(getServicesRes.body.data[0].id).toBe(serviceId);

    // 3. Create a draft invoice using compatibility route
    const createInvoiceRes = await request(app.getHttpServer())
      .post('/billing')
      .send({
        resource: 'invoice',
        patientId: 'pat-demo',
        items: [
          {
            type: 'service',
            referenceId: serviceId,
            description: 'Consultation Fee',
            quantity: 1,
            unitPrice: 300.0,
            tax: 0,
            total: 300.0,
          },
        ],
        discountAmount: 20.0,
      })
      .expect(201);

    expect(createInvoiceRes.body.success).toBe(true);
    expect(createInvoiceRes.body.message).toBe('Invoice created');
    const invoiceId = createInvoiceRes.body.data.id;
    expect(invoiceId).toBeDefined();
    expect(createInvoiceRes.body.data.totalAmount).toBe(280.0);
    expect(createInvoiceRes.body.data.balanceDue).toBe(280.0);

    // 4. Query invoices
    const getInvoicesRes = await request(app.getHttpServer())
      .get('/billing?resource=invoices&status=draft')
      .expect(200);

    expect(getInvoicesRes.body.success).toBe(true);
    expect(getInvoicesRes.body.data).toHaveLength(1);
    expect(getInvoicesRes.body.data[0].id).toBe(invoiceId);

    // 5. Record a partial payment
    const createPaymentRes = await request(app.getHttpServer())
      .post('/billing')
      .send({
        resource: 'payment',
        invoiceId,
        amount: 100.0,
        paymentMethod: 'cash',
        notes: 'Partial payment in cash',
      })
      .expect(201);

    expect(createPaymentRes.body.success).toBe(true);
    expect(createPaymentRes.body.message).toBe('Payment recorded');
    expect(createPaymentRes.body.data.amount).toBe(100.0);

    // 6. Query payments
    const getPaymentsRes = await request(app.getHttpServer())
      .get(`/billing?resource=payments&invoiceId=${invoiceId}`)
      .expect(200);

    expect(getPaymentsRes.body.success).toBe(true);
    expect(getPaymentsRes.body.data).toHaveLength(1);
    expect(getPaymentsRes.body.data[0].amount).toBe(100.0);

    // 7. Check billing stats
    const getStatsRes = await request(app.getHttpServer())
      .get('/billing?resource=stats')
      .expect(200);

    expect(getStatsRes.body.success).toBe(true);
    expect(getStatsRes.body.data.todayRevenue).toBe(100.0);
    expect(getStatsRes.body.data.pendingInvoices).toBe(1);
    expect(getStatsRes.body.data.outstandingBalance).toBe(180.0);

    // 8. Update invoice using compatibility PATCH
    const patchInvoiceRes = await request(app.getHttpServer())
      .patch('/billing')
      .send({
        resource: 'invoice',
        id: invoiceId,
        status: 'cancelled',
      })
      .expect(200);

    expect(patchInvoiceRes.body.success).toBe(true);
    expect(patchInvoiceRes.body.data.status).toBe('cancelled');
    expect(patchInvoiceRes.body.data.cancelledAt).toBeDefined();
  });
});
