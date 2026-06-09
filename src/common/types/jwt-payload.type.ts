/**
 * JWT payload structure.
 * Signed into the access/refresh token.
 * Keep lean — large payloads slow down requests.
 */
export interface JwtPayload {
  sub: string;       // User ID
  email: string;
  roles: string[];
  permissions: string[];
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

/**
 * Authenticated user attached to request by JwtAuthGuard.
 * Available via @CurrentUser() decorator.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}
