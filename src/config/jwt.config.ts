import { registerAs } from '@nestjs/config';

/**
 * JWT configuration.
 * Separate access/refresh token secrets & expiries for security.
 * Refresh tokens rotate on each use (implementation in AuthService).
 */
export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
}));
