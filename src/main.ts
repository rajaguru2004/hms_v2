// Must come first: decorators in the imports below read process.env.
import './config/load-env';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import {
  ALLOW_UNREVIEWED_PHRASEBOOKS_ENV,
  PHRASEBOOKS,
  unreviewedLanguagesInUse,
} from './modules/case-taking/engine/phrasebook';

/**
 * Bootstrap — application entry point.
 *
 * Order matters:
 * 1. Create app
 * 2. Apply security middleware (Helmet, CORS)
 * 3. Apply global pipes
 * 4. Configure Swagger (dev/staging only)
 * 5. Start listening
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Disable built-in logger — replaced by Pino
    bufferLogs: true,
  });

  const config = app.get(ConfigService);

  // ── Use Pino as NestJS logger ─────────────────────────────────────────────
  app.useLogger(app.get(Logger));

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: config.get('app.isProduction'),
    }),
  );

  // `ngrok-skip-browser-warning` is on this list because the app sends it on
  // every request (`dio_client.dart`), and a header the client sends but the
  // preflight does not allow is refused by the browser before it is sent. On
  // a handset that costs nothing - Dio is not a browser and does no preflight
  // - so the mismatch stayed invisible until the app was opened in one, where
  // every call failed as a bare network error with "Can't reach the server"
  // on screen and a CORS line only in the browser console. Allowing it is
  // safe: it is ngrok's own opt-out header, inert against every other server,
  // and carries nothing.
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-correlation-id',
      'ngrok-skip-browser-warning',
    ],
    credentials: true,
  });

  // ── API Prefix + Versioning ───────────────────────────────────────────────
  const apiPrefix = config.get<string>('app.apiPrefix', 'api');
  app.setGlobalPrefix(apiPrefix);

  // ── Global Validation Pipe ────────────────────────────────────────────────
  // whitelist: strips unknown fields (mass assignment protection)
  // forbidNonWhitelisted: throws 400 on unknown fields
  // transform: auto-convert types (string '1' → number 1)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  app.enableShutdownHooks();

  // ── Swagger ───────────────────────────────────────────────────────────────
  // Only expose Swagger in non-production environments
  if (!config.get<boolean>('app.isProduction')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(config.get<string>('app.appName', 'HMS v2') + ' API')
      .setDescription(
        'Hospital Management System v2 — Enterprise REST API\n\n' +
          '## Authentication\n' +
          'Use `POST /api/auth/login` to obtain a Bearer token.\n' +
          'Click **Authorize** and paste the `accessToken`.',
      )
      .setVersion(config.get<string>('app.appVersion', '2.0.0'))
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'Bearer',
      )
      .addTag('Authentication', 'Login, refresh, and logout')
      .addTag('Users', 'User management (CRUD)')
      .addTag('Health', 'Health check endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  // ── Start Server ──────────────────────────────────────────────────────────
  const port = config.get<number>('app.port', 3000);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`🚀 HMS v2 API running on http://localhost:${port}/${apiPrefix}`);
  logger.log(`📚 Swagger docs: http://localhost:${port}/${apiPrefix}/docs`);
  logger.log(`🌱 Environment: ${config.get('app.nodeEnv')}`);

  warnAboutUnreviewedTranslations(logger);
}

/**
 * Say out loud, once per boot, which patients are being asked clinical
 * questions in wording nobody has checked.
 *
 * `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS` is a demonstration override: it lets
 * a machine-drafted translation reach a patient so the pipeline can be proved
 * before a clinician spends an afternoon on it. That is a defensible thing to
 * do on a demo box and an indefensible one in a waiting room, and the
 * difference between the two is whether anybody noticed the flag was on. A
 * silent override is how a demo setting survives into production, so this is a
 * `warn` naming every affected language and its provenance — not a `log` line
 * that scrolls past with the Swagger URL.
 */
function warnAboutUnreviewedTranslations(logger: Logger): void {
  const unreviewed = unreviewedLanguagesInUse();
  if (unreviewed.length === 0) return;

  logger.warn(
    {
      flag: ALLOW_UNREVIEWED_PHRASEBOOKS_ENV,
      languages: unreviewed.map((code) => ({
        code,
        source: PHRASEBOOKS[code].source,
        reviewedAt: PHRASEBOOKS[code].reviewedAt,
      })),
    },
    `${ALLOW_UNREVIEWED_PHRASEBOOKS_ENV}=true — patients will be asked clinical ` +
      `questions in UNREVIEWED translations (${unreviewed.join(', ')}). No ` +
      'clinician has signed this wording off. Do not run this where real ' +
      'patients are being interviewed.',
  );
}

void bootstrap();
