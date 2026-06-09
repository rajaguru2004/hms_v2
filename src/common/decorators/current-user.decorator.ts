import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/**
 * @CurrentUser() parameter decorator.
 * Extracts the authenticated user from the request (set by JwtAuthGuard).
 *
 * Usage:
 *   @Get('profile')
 *   getProfile(@CurrentUser() user: AuthenticatedUser) {}
 *
 *   // Get specific field:
 *   @Get('profile')
 *   getProfile(@CurrentUser('id') userId: string) {}
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = request.user;
    return field ? user?.[field] : user;
  },
);

/**
 * @Public() — marks a route as publicly accessible (skips JwtAuthGuard).
 * JwtAuthGuard checks for this metadata before requiring a token.
 */
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
