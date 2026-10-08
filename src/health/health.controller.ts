import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { HealthCheckFilter } from './health-check.filter';
import { RedisHealthIndicator } from './redis.health';

const CHECK_TIMEOUT_MS = 1000;

@ApiTags('health')
@Controller('health')
@UseFilters(HealthCheckFilter)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  // Liveness never checks dependencies: restarting the process cannot fix a
  // database outage, and failing here would make every instance restart.
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness: the process is running' })
  live() {
    return this.health.check([]);
  }

  // Readiness fails while a dependency is down, so traffic is routed away
  // until it recovers.
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness: MySQL and Redis are reachable' })
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: CHECK_TIMEOUT_MS }),
      () => this.redis.pingCheck('redis', CHECK_TIMEOUT_MS),
    ]);
  }
}
