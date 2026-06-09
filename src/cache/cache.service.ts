import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * AppCacheService — type-safe Redis cache wrapper.
 *
 * Uses ioredis directly for full control over serialization and TTL.
 * Provides get/set/del/invalidateByPrefix methods.
 *
 * Why ioredis directly vs NestJS CacheModule?
 * CacheModule abstraction is too thin for enterprise use — we need:
 * - Pattern-based key invalidation
 * - Typed deserialization
 * - Health check integration
 */
@Injectable()
export class AppCacheService {
  private readonly logger = new Logger(AppCacheService.name);
  private readonly redis: Redis;
  private readonly defaultTtl: number;

  constructor(private readonly config: ConfigService) {
    this.defaultTtl = this.config.get<number>('redis.ttl', 300);

    this.redis = new Redis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password'),
      db: this.config.get<number>('redis.db', 0),
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 100, 3000);
      },
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error', err);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });
  }

  /**
   * Get cached value. Returns null on miss or parse error.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (err) {
      this.logger.error(`Cache get error for key ${key}`, err);
      return null;
    }
  }

  /**
   * Set a cache value with optional TTL (seconds).
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const expiry = ttl ?? this.defaultTtl;
      await this.redis.setex(key, expiry, serialized);
    } catch (err) {
      this.logger.error(`Cache set error for key ${key}`, err);
    }
  }

  /**
   * Delete a specific key.
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.error(`Cache del error for key ${key}`, err);
    }
  }

  /**
   * Delete all keys matching a pattern. Use for cache invalidation.
   * e.g. invalidateByPrefix('user:123:*') clears all user-specific caches.
   */
  async invalidateByPrefix(prefix: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`${prefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.debug(`Invalidated ${keys.length} cache keys with prefix: ${prefix}`);
      }
    } catch (err) {
      this.logger.error(`Cache invalidation error for prefix ${prefix}`, err);
    }
  }

  /**
   * Build a namespaced cache key.
   * Usage: AppCacheService.buildKey('user', userId, 'profile')
   * → 'user:abc-123:profile'
   */
  static buildKey(...parts: string[]): string {
    return parts.join(':');
  }

  /**
   * Ping Redis — used by health check.
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get the underlying Redis client for advanced usage.
   */
  getClient(): Redis {
    return this.redis;
  }
}
