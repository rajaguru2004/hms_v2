import { parse } from 'node:path';

import { SkipThrottle } from '@nestjs/throttler';
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../cache/cache.service';

/**
 * The filesystem root the disk check measures.
 *
 * `/` is correct where this deploys — the Dockerfile builds a Linux image — but
 * a developer runs the same code on Windows, where `check-disk-space` rejects a
 * bare `/` outright: "The following path is invalid (should be X:\\...)". That
 * rejection is not caught as an unhealthy indicator, it throws, and terminus
 * answers the whole of `GET /health` with a 500. The symptom is a health
 * endpoint that reports the service as broken while every other route works,
 * which is exactly backwards.
 *
 * `parse(cwd()).root` is `/` on POSIX, so Linux behaviour is unchanged.
 */
const STORAGE_ROOT = parse(process.cwd()).root;

/**
 * HealthController — Kubernetes/load-balancer health probes.
 *
 * /health/live  — liveness probe: is the app running? (Always 200 if process alive)
 * /health/ready — readiness probe: are dependencies ready? (DB + Redis check)
 * /health       — full health report
 *
 * All health endpoints are @Public() — no auth required.
 * Do NOT add sensitive data to health responses.
 */
@ApiTags('Health')
// Liveness and readiness are polled continuously by Docker and any
// orchestrator; rate-limiting them would report a healthy service as down.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Full health check (DB + Redis + Memory + Disk)' })
  async check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024), // 512MB
      () => this.memory.checkRSS('memory_rss', 512 * 1024 * 1024),
      () =>
        this.disk.checkStorage('storage', {
          path: STORAGE_ROOT,
          thresholdPercent: 0.9, // Alert at 90% disk usage
        }),
    ]);
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — is the process alive?' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — are dependencies ready?' })
  async readiness() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
    ]);
  }
}
