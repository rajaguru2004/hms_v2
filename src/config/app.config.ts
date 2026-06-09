import { registerAs } from '@nestjs/config';

/**
 * Application configuration factory.
 * Centralizes all app-level settings loaded from environment variables.
 * Avoids magic strings scattered across the codebase.
 */
export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  appName: process.env.APP_NAME || 'HMS v2',
  appVersion: process.env.APP_VERSION || '2.0.0',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
}));
