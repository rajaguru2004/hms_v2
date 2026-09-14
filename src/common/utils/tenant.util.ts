import { ForbiddenException } from '../exceptions/app.exception';
import { ErrorCodes } from '../exceptions/error-codes';
import { SystemRole } from '../enums/role.enum';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/**
 * Which organisation a request is allowed to act on.
 *
 * The JWT has carried `organizationId` since RBAC landed, but several settings
 * routes kept taking the organisation from a query parameter or a request body
 * — so any holder of `SETTINGS_READ` could read, and in one case *write*,
 * another hospital's configuration by changing a number in the URL. The id in
 * the token is the only one that was ever authenticated, so that is the one
 * these helpers return.
 *
 * SUPER_ADMIN keeps the override: cross-organisation administration is a real
 * job, and it is the one role the guards already treat as global.
 */
export function resolveOrganizationId(
  currentUser: Pick<AuthenticatedUser, 'organizationId' | 'roles'> | undefined,
  requested?: string | null,
): string {
  const own = currentUser?.organizationId;

  if (!own) {
    // Every authenticated request has one. Reaching here means the guard was
    // bypassed or the token predates the claim; either way, refusing is the
    // only safe answer — the previous code substituted a literal 'org-demo',
    // which silently pointed writes at an organisation that does not exist.
    throw new ForbiddenException(
      'Your account is not attached to an organisation.',
      ErrorCodes.FORBIDDEN,
    );
  }

  if (!requested || requested === own) {
    return own;
  }

  if (currentUser?.roles?.includes(SystemRole.SUPER_ADMIN)) {
    return requested;
  }

  throw new ForbiddenException(
    'You cannot act on another organisation.',
    ErrorCodes.FORBIDDEN,
  );
}

/** True when this user may deliberately reach outside their own organisation. */
export function isCrossTenantAdmin(
  currentUser: Pick<AuthenticatedUser, 'roles'> | undefined,
): boolean {
  return currentUser?.roles?.includes(SystemRole.SUPER_ADMIN) ?? false;
}
