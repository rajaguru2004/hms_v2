import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * The boot smoke test: the module graph resolves and an unauthenticated public
 * route answers through the global envelope.
 *
 * It used to be the Nest scaffold's `GET / -> 'Hello World!'`, which had been
 * failing since the day AppModule stopped listing AppController: there is no
 * root route to return it, and `main.ts` puts every route behind the `api`
 * prefix besides. That it went unnoticed is the point - this file, like the
 * other two e2e specs, was invisible to Jest's crawler (see the note on
 * maxWorkers in jest-e2e.json for the other half of that story), so nothing
 * ran it.
 *
 * The prefix and the validation pipe are restated here because `app.init()`
 * applies neither: a test that skips them is testing a different application
 * from the one that gets deployed.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the liveness probe without a token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200);

    const body = res.body as {
      success: boolean;
      data: { status: string; timestamp: string };
    };

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.timestamp).toBeDefined();
  });

  it('serves nothing outside the api prefix', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('refuses an unauthenticated request to a protected route', () => {
    return request(app.getHttpServer()).get('/api/patients').expect(401);
  });
});
