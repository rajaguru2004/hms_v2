import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Application-level smoke test.
 *
 * This used to assert `GET /` returned the Nest scaffold's "Hello World!".
 * `AppController`/`AppService` still exist on disk but are no longer listed in
 * `AppModule`'s metadata (it declares `imports` and `providers`, and no
 * `controllers` array at all), so `/` is a genuine 404 — the scaffold route was
 * dropped in favour of the real feature modules. The liveness probe is the
 * route that actually stands for "the app booted and serves HTTP": it is
 * `@Public()`, so it survives the global `JwtAuthGuard`, and `@SkipThrottle()`,
 * so it survives the global `ThrottlerGuard`.
 *
 * Note that the test app is built with `createNestApplication()` and therefore
 * has no global prefix — `main.ts` applies `setGlobalPrefix('api')`, so the
 * same route is `/api/health/live` when the server is run for real.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health/live (GET) reports the process as alive', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    // ResponseInterceptor wraps every non-enveloped payload. Typed rather
    // than read off `any`, which the lint rules refuse and which would also
    // pass silently if the envelope stopped carrying `data` at all.
    const body = res.body as {
      success: boolean;
      data: { status: string; timestamp: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.timestamp).toBeDefined();
  });

  it('/ (GET) is not routed — the scaffold root controller is unregistered', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });
});
