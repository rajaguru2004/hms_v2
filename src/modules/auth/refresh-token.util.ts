import { createHash } from 'crypto';

/**
 * How a refresh token is stored.
 *
 * It used to be bcrypt, which is salted — so `hashPassword(token)` produced a
 * different string every call, and the lookup
 * `findUnique({ where: { token: await hashPassword(refreshToken) } })` could
 * never match a stored row. `POST /auth/refresh` returned 401 for everyone,
 * always, and `logout` revoked nothing while returning 204, so both looked
 * like they worked.
 *
 * SHA-256 is the right primitive here and bcrypt was the wrong one. Bcrypt's
 * cost exists to slow down guessing a *low-entropy* secret; a refresh token is
 * a signed JWT with 256+ bits of entropy, so there is nothing to guess. What we
 * need is a deterministic index — the hash is only there so a database dump
 * does not hand out live sessions.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** True for a hash written by the old bcrypt scheme, which can never match. */
export function isLegacyRefreshTokenHash(stored: string): boolean {
  return stored.startsWith('$2');
}
