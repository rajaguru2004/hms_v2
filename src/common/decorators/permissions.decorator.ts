import { SetMetadata } from '@nestjs/common';
import { Permission } from '../enums/permission.enum';

export const PERMISSIONS_KEY = 'permissions';

/**
 * @Permissions() decorator — fine-grained permission checks.
 *
 * Usage:
 *   @Permissions(Permission.USER_CREATE)
 *   @Post()
 *   create() {}
 *
 * Checked by PermissionsGuard. Use alongside or instead of @Roles().
 */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
