import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * Hash utility — wraps bcrypt for password hashing.
 * Salt rounds = 12 (good balance of security vs CPU cost for 2024+).
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function comparePassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
