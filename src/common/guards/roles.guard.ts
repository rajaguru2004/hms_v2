import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/**
 * RolesGuard — checks if the authenticated user has at least one required role.
 *
 * Works with @Roles() decorator. If no roles specified, access is granted.
 * SUPER_ADMIN bypasses all role checks.
 *
 * Usage:
 *   Apply globally or per-controller. Requires JwtAuthGuard to run first.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator = allow all authenticated users
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Access denied');

    // SUPER_ADMIN bypasses all role restrictions
    if (user.roles.includes('SUPER_ADMIN')) return true;

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) throw new ForbiddenException('Insufficient role permissions');

    return true;
  }
}
