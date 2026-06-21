import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

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

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
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
}

void bootstrap();
