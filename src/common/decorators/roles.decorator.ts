import { SetMetadata } from '@nestjs/common';
import { SystemRole } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * @Roles() decorator — used on controllers/handlers to specify required roles.
 *
 * Usage:
 *   @Roles(SystemRole.ADMIN, SystemRole.SUPER_ADMIN)
 *   @Get()
 *   findAll() {}
 *
 * Checked by RolesGuard.
 */
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES_KEY, roles);
