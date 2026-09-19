/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';

describe('LaboratoryController (e2e)', () => {
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

    // Seed required Organization, User and Patient
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

  it('should run compatibility workflow: create test, order, record result, fetch stats, and update', async () => {
    // 1. Create a lab test via compatibility route
    const createTestRes = await request(app.getHttpServer())
      .post('/laboratory')
      .send({
        resource: 'test',
        testName: 'Complete Blood Count',
        testCode: 'CBC',
        testCategory: 'hematology',
        testType: 'quantitative',
        specimenType: 'blood',
        price: 150.0,
      })
      .expect(201);

    expect(createTestRes.body.success).toBe(true);
    // ResponseInterceptor emits one standard envelope message for every
    // non-enveloped payload; the old per-endpoint strings no longer exist
    // anywhere in src/.
    expect(createTestRes.body.message).toBe('Operation completed successfully');
    const testId = createTestRes.body.data.id;
    expect(testId).toBeDefined();

    // 2. Query lab tests
    const getTestsRes = await request(app.getHttpServer())
      .get('/laboratory?resource=tests&category=hematology')
      .expect(200);

    expect(getTestsRes.body.success).toBe(true);
    expect(getTestsRes.body.data).toHaveLength(1);
    expect(getTestsRes.body.data[0].id).toBe(testId);

    // 3. Create a lab order
    const createOrderRes = await request(app.getHttpServer())
      .post('/laboratory')
      .send({
        resource: 'order',
        patientId: 'pat-demo',
        tests: [
          {
            testId,
            testName: 'Complete Blood Count',
            urgency: 'routine',
          },
        ],
        clinicalIndication: 'Fatigue screen',
        priority: 'routine',
      })
      .expect(201);

    expect(createOrderRes.body.success).toBe(true);
    expect(createOrderRes.body.message).toBe(
      'Operation completed successfully',
    );
    const orderId = createOrderRes.body.data.id;
    expect(orderId).toBeDefined();
    expect(createOrderRes.body.data.status).toBe('pending');

    // 4. Query lab orders
    const getOrdersRes = await request(app.getHttpServer())
      .get('/laboratory?resource=orders&status=pending')
      .expect(200);

    expect(getOrdersRes.body.success).toBe(true);
    expect(getOrdersRes.body.data.data).toHaveLength(1);
    expect(getOrdersRes.body.data.data[0].id).toBe(orderId);

    // 5. Create a result for the order
    const createResultRes = await request(app.getHttpServer())
      .post('/laboratory')
      .send({
        resource: 'result',
        orderId,
        testId,
        resultValue: '13.5',
        resultUnit: 'g/dL',
        isAbnormal: false,
        isCritical: false,
        flag: 'N',
        comment: 'Normal range hematology CBC',
      })
      .expect(201);

    expect(createResultRes.body.success).toBe(true);
    expect(createResultRes.body.message).toBe(
      'Operation completed successfully',
    );
    const resultId = createResultRes.body.data.id;
    expect(resultId).toBeDefined();

    // 6. Check that order status moved to 'in_progress' automatically
    const getOrdersInProgressRes = await request(app.getHttpServer())
      .get('/laboratory?resource=orders&status=in_progress')
      .expect(200);

    expect(getOrdersInProgressRes.body.success).toBe(true);
    expect(getOrdersInProgressRes.body.data.data).toHaveLength(1);
    expect(getOrdersInProgressRes.body.data.data[0].id).toBe(orderId);

    // 7. Query results
    const getResultsRes = await request(app.getHttpServer())
      .get(`/laboratory?resource=results&orderId=${orderId}`)
      .expect(200);

    expect(getResultsRes.body.success).toBe(true);
    expect(getResultsRes.body.data).toHaveLength(1);
    expect(getResultsRes.body.data[0].id).toBe(resultId);

    // 8. Fetch stats
    const getStatsRes = await request(app.getHttpServer())
      .get('/laboratory?resource=stats')
      .expect(200);

    expect(getStatsRes.body.success).toBe(true);
    expect(getStatsRes.body.data.pending).toBe(0);
    expect(getStatsRes.body.data.inProgress).toBe(1);
    expect(getStatsRes.body.data.totalTests).toBe(1);

    // 9. Patch test catalog price
    const patchTestRes = await request(app.getHttpServer())
      .patch('/laboratory')
      .send({
        resource: 'test',
        id: testId,
        price: 180.0,
      })
      .expect(200);

    expect(patchTestRes.body.success).toBe(true);
    expect(patchTestRes.body.data.price).toBe(180.0);

    // 10. Patch order details
    const patchOrderRes = await request(app.getHttpServer())
      .patch('/laboratory')
      .send({
        resource: 'order',
        id: orderId,
        notes: 'Priority changed',
        priority: 'urgent',
      })
      .expect(200);

    expect(patchOrderRes.body.success).toBe(true);
    expect(patchOrderRes.body.data.priority).toBe('urgent');
    expect(patchOrderRes.body.data.notes).toBe('Priority changed');

    // 11. Patch result (verification simulation)
    const patchResultRes = await request(app.getHttpServer())
      .patch('/laboratory')
      .send({
        resource: 'result',
        id: resultId,
        verifiedAt: new Date().toISOString(),
      })
      .expect(200);

    expect(patchResultRes.body.success).toBe(true);
    expect(patchResultRes.body.data.verifiedAt).toBeDefined();

    // 12. Check order complete status after result verification
    const getCompletedOrdersRes = await request(app.getHttpServer())
      .get('/laboratory?resource=orders&status=completed')
      .expect(200);

    expect(getCompletedOrdersRes.body.success).toBe(true);
    expect(getCompletedOrdersRes.body.data.data).toHaveLength(1);
    expect(getCompletedOrdersRes.body.data.data[0].id).toBe(orderId);
  });

  it('should run clean RESTful routes workflow', async () => {
    // 1. Create a test catalog entry
    const createTestRes = await request(app.getHttpServer())
      .post('/laboratory/tests')
      .send({
        testName: 'Lipid Profile',
        testCode: 'LPD',
        testCategory: 'chemistry',
        price: 250.0,
      })
      .expect(201);

    const testId = createTestRes.body.data.id;
    expect(testId).toBeDefined();

    // 2. Fetch tests list
    const getTestsRes = await request(app.getHttpServer())
      .get('/laboratory/tests?category=chemistry')
      .expect(200);

    expect(getTestsRes.body.data).toHaveLength(1);

    // 3. Update test entry
    const updateTestRes = await request(app.getHttpServer())
      .patch(`/laboratory/tests/${testId}`)
      .send({
        price: 280.0,
      })
      .expect(200);

    expect(updateTestRes.body.data.price).toBe(280.0);

    // 4. Create an order
    const createOrderRes = await request(app.getHttpServer())
      .post('/laboratory/orders')
      .send({
        patientId: 'pat-demo',
        tests: [{ testId, testName: 'Lipid Profile', urgency: 'routine' }],
        clinicalIndication: 'Cardiac screening',
      })
      .expect(201);

    const orderId = createOrderRes.body.data.id;
    expect(orderId).toBeDefined();

    // 5. Fetch orders list
    const getOrdersRes = await request(app.getHttpServer())
      .get('/laboratory/orders?status=pending')
      .expect(200);

    expect(getOrdersRes.body.data.data).toHaveLength(1);

    // 6. Update order status
    const updateOrderRes = await request(app.getHttpServer())
      .patch(`/laboratory/orders/${orderId}`)
      .send({
        status: 'sample_collected',
        accessionNumber: 'BARCODE-999',
      })
      .expect(200);

    expect(updateOrderRes.body.data.status).toBe('sample_collected');
    // Accession numbers are system-generated on sample collection and the
    // client-supplied value is deliberately discarded to prevent duplicates
    // (laboratory.service.ts updateOrder; asserted in laboratory.service.spec.ts).
    expect(updateOrderRes.body.data.accessionNumber).not.toBe('BARCODE-999');
    expect(updateOrderRes.body.data.accessionNumber).toMatch(
      /^ACC-[0-9A-Z]{8}$/,
    );

    // 7. Add result
    const createResultRes = await request(app.getHttpServer())
      .post('/laboratory/results')
      .send({
        orderId,
        testId,
        resultValue: '180',
        resultUnit: 'mg/dL',
      })
      .expect(201);

    const resultId = createResultRes.body.data.id;
    expect(resultId).toBeDefined();

    // 8. Fetch results list
    const getResultsRes = await request(app.getHttpServer())
      .get(`/laboratory/results?orderId=${orderId}`)
      .expect(200);

    expect(getResultsRes.body.data).toHaveLength(1);

    // 9. Update result (verification)
    const updateResultRes = await request(app.getHttpServer())
      .patch(`/laboratory/results/${resultId}`)
      .send({
        verifiedAt: new Date().toISOString(),
      })
      .expect(200);

    expect(updateResultRes.body.data.verifiedAt).toBeDefined();

    // 10. Fetch stats
    const getStatsRes = await request(app.getHttpServer())
      .get('/laboratory/stats')
      .expect(200);

    expect(getStatsRes.body.data.completedToday).toBe(1);
    expect(getStatsRes.body.data.totalTests).toBe(1);
  });
});
