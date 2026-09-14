import { Injectable } from '@nestjs/common';

import { AppCacheService } from './cache.service';

/**
 * Drops everything cached about one user's identity.
 *
 * The JWT strategy caches the user (`auth:user:<id>`) and the access map
 * (`auth:access-map:<id>`) for five minutes each. Only the first was ever
 * invalidated, and only when permissions were assigned — so deactivating an
 * account, changing somebody's role from the staff directory, or changing a
 * password left the old identity live for up to five minutes. On a shared ward
 * tablet that is five minutes of a revoked account still working.
 *
 * One place, called from every write that changes who a user is or what they
 * may do. It lives in the global cache module rather than the auth module so
 * the services that need it — roles, users, settings — can inject it without
 * importing auth and risking a cycle.
 */
@Injectable()
export class AuthCacheService {
  constructor(private readonly cacheService: AppCacheService) {}

  async invalidateUser(userId: string): Promise<void> {
    await Promise.all([
      this.cacheService.del(AppCacheService.buildKey('auth:user', userId)),
      this.cacheService.del(
        AppCacheService.buildKey('auth:access-map', userId),
      ),
      this.cacheService.del(AppCacheService.buildKey('user', userId)),
    ]);
  }

  async invalidateUsers(userIds: readonly string[]): Promise<void> {
    await Promise.all(userIds.map((id) => this.invalidateUser(id)));
  }
}
