import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../users/user.repository';
import { AppCacheService } from '../../cache/cache.service';
import {
  JwtPayload,
  AuthenticatedUser,
} from '../../common/types/jwt-payload.type';
import { UnauthorizedException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

/**
 * JwtStrategy — validates incoming JWT tokens.
 *
 * On valid token: extracts payload, loads fresh user+roles from DB,
 * attaches AuthenticatedUser to request.user.
 *
 * Why load from DB each request?
 * - Tokens can't be revoked after issue without DB check
 * - Role/permission changes take effect immediately
 * - Trade-off: 1 extra query per request (mitigated by cache in UserRepository if needed)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly userRepository: UserRepository,
    private readonly cacheService: AppCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException(
        'Invalid token type',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    // Taken from the signed payload rather than re-read per request: it is
    // resolved once in `AuthService.generateTokenPair`, and a patient's link to
    // their record does not change during the fifteen minutes a token lives.
    const { patientId } = payload;

    const cacheKey = AppCacheService.buildKey('auth:user', payload.sub);
    const cachedUser = await this.cacheService.get<AuthenticatedUser>(cacheKey);
    if (cachedUser) {
      // The cached entry may predate the patient link — it is keyed by user id
      // and lives for five minutes, so an account that claimed its record in
      // that window would be served an `AuthenticatedUser` with no `patientId`
      // and then refused by `PatientSelfGuard` on its own data. The token is
      // signed, so preferring its claim over a stale blank is safe.
      return { ...cachedUser, patientId: cachedUser.patientId ?? patientId };
    }

    const user = await this.userRepository.findByIdWithRolesAndPermissions(
      payload.sub,
    );

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'User not found or inactive',
        ErrorCodes.UNAUTHORIZED,
      );
    }

    // Extract flat lists of role names and permission names
    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.name),
        ),
      ),
    ];

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      roles,
      permissions,
      organizationId: user.organizationId,
      patientId,
    };

    // Cache authenticated user details for 5 minutes (300s)
    await this.cacheService.set(cacheKey, authenticatedUser, 300);

    return authenticatedUser;
  }
}
