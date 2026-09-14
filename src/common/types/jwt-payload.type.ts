/**
 * JWT payload structure.
 * Signed into the access/refresh token.
 * Keep lean — large payloads slow down requests.
 */
export interface JwtPayload {
  sub: string; // User ID
  email: string;
  roles: string[];
  permissions: string[];
  organizationId: string;
  type: 'access' | 'refresh';

  /**
   * The Patient record this account *is*, for a portal login.
   *
   * Absent for every staff account. It is a claim rather than a lookup because
   * a patient-scoped request must know which record it may touch before it does
   * any work, and resolving it per request would put a query in front of every
   * route the portal calls.
   */
  patientId?: string;

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
  organizationId: string;

  /**
   * Which patient this caller is. The only id a PATIENT-role request may act
   * on — see `PatientSelfGuard`, which refuses rather than trusting an id that
   * arrived in the URL.
   */
  patientId?: string;
}
