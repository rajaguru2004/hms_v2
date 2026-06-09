import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/**
 * PermissionsGuard — fine-grained permission check.
 *
 * User must have ALL specified permissions (AND logic).
 * Use @Permissions() decorator on route handlers.
 * SUPER_ADMIN bypasses all permission checks.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Access denied');

    // SUPER_ADMIN bypasses all permission restrictions
    if (user.roles.includes('SUPER_ADMIN')) return true;

    const hasAll = requiredPermissions.every((perm) =>
      user.permissions.includes(perm),
    );

    if (!hasAll) throw new ForbiddenException('Insufficient permissions');

    return true;
  }
}
