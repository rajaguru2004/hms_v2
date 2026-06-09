/**
 * Global application constants.
 * Centralised here to avoid magic strings/numbers across codebase.
 */

export const APP_NAME = 'HMS v2';
export const API_VERSION = 'v2';

// Pagination defaults
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

// Cache key prefixes — use these when building cache keys
export const CACHE_KEYS = {
  USER: 'user',
  ROLE: 'role',
  PERMISSION: 'permission',
  USER_ROLES: 'user_roles',
} as const;

// Correlation ID header name (used by RequestIdMiddleware)
export const CORRELATION_ID_HEADER = 'x-correlation-id';

// JWT token types
export const TOKEN_TYPES = {
  ACCESS: 'access',
  REFRESH: 'refresh',
} as const;

// Soft delete field name in Prisma models
export const SOFT_DELETE_FIELD = 'isDeleted';
