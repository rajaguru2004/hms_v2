// Must come first: decorators in the imports below read process.env.
import './config/load-env';

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';
import {
  validationSchema,
  validationOptions,
} from './config/validation.schema';

import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AppCacheModule } from './cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { BillingModule } from './modules/billing/billing.module';
import { ConsultationsModule } from './modules/consultations/consultations.module';
import { InpatientModule } from './modules/inpatient/inpatient.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { LaboratoryModule } from './modules/laboratory/laboratory.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { PreTriageModule } from './modules/pre-triage/pre-triage.module';
import { QueueModule } from './modules/queue/queue.module';
import { RadiologyModule } from './modules/radiology/radiology.module';
import { SettingsModule } from './modules/settings/settings.module';
import { DeathCertificatesModule } from './modules/death-certificates/death-certificates.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { envFilePaths } from '../prisma/env-paths';

/**
 * AppModule — root module.
 *
 * Architectural choices:
 * - ConfigModule: isGlobal=true → no need to import in every module
 * - PrismaModule: @Global() → same
 * - AuditModule: @Global() → services log without importing AuditModule
 * - AppCacheModule: @Global() → services cache without importing CacheModule
 * - ThrottlerModule: rate limiting applied globally via APP_GUARD
 * - LoggerModule: Pino HTTP logging for structured JSON logs in production
 * - Global guards/interceptors/filters applied via APP_* providers
 */
@Module({
  imports: [
    // Config — must be first
    ConfigModule.forRoot({
      isGlobal: true,
      // The order is shared with prisma.config.ts and prisma/load-env.ts so
      // the API and the Prisma tooling can never resolve different databases.
      envFilePath: envFilePaths(),
      load: [appConfig, databaseConfig, jwtConfig, redisConfig],
      validationSchema,
      validationOptions,
      expandVariables: true,
    }),

    // Rate limiting — 100 requests per 60 seconds per IP
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Structured logging with Pino
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: true },
              }
            : undefined,
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        autoLogging: false, // We log manually via LoggingInterceptor
        serializers: {
          req: (req: Record<string, unknown>) => ({
            method: req.method as string,
            url: req.url as string,
          }),
          res: (res: Record<string, unknown>) => ({
            statusCode: res.statusCode as number,
          }),
        },
      },
    }),

    // Infrastructure
    PrismaModule,
    AuditModule,
    AppCacheModule,

    // Feature modules
    AuthModule,
    UsersModule,
    HealthModule,
    PatientsModule,
    AppointmentsModule,
    BillingModule,
    ConsultationsModule,
    InpatientModule,
    IntegrationsModule,
    LaboratoryModule,
    PharmacyModule,
    PreTriageModule,
    QueueModule,
    RadiologyModule,
    SettingsModule,
    DeathCertificatesModule,
    DashboardModule,
    RolesModule,
    PermissionsModule,
  ],

  providers: [
    // Global exception filter — handles all unhandled errors
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Global response interceptor — wraps all responses in standard envelope
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },

    // Global logging interceptor — logs all requests
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },

    // Rate limiting, registered BEFORE the auth guard so an unauthenticated
    // flood is rejected before it reaches bcrypt. This was configured but never
    // registered, so there was no rate limiting anywhere — including unlimited
    // password attempts on /auth/login.
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Global JWT guard — all routes require auth unless @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply correlation ID middleware to all routes
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
