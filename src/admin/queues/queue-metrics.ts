import { InjectQueue } from '@nestjs/bullmq';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { ApiProblemResponse } from '../../common/problem/problem-details.dto';
import { ProblemTypes } from '../../common/problem/problem-types';
import { ProblemException } from '../../common/problem/problem.exception';
import { QueueNames, SEND_QUEUES } from '../../queue/queue.constants';
import { AdminKeyGuard } from '../admin-key.guard';

export class QueueMetrics {
  @ApiProperty({ example: 'email-marketing' })
  name: string;

  @ApiProperty({ example: 9500, description: 'Waiting to be picked up' })
  waiting: number;

  @ApiProperty({ example: 5 })
  active: number;

  @ApiProperty({ example: 12, description: 'Backing off before a retry' })
  delayed: number;

  @ApiProperty({ example: 3, description: 'Failed jobs still kept' })
  failed: number;

  @ApiProperty({ example: 480, description: 'Completed jobs still kept' })
  completed: number;

  @ApiProperty({
    example: false,
    description: 'Paused: no new job is picked up by any worker',
  })
  paused: boolean;
}

export class QueueMetricsResponse {
  @ApiProperty({ type: [QueueMetrics] })
  queues: QueueMetrics[];

  @ApiProperty({
    example: 4,
    description: 'Jobs in the dead-letter queue; the DEAD notifications',
  })
  dlq: number;
}

/**
 * Job counts per send queue from Redis. failed and completed are bounded by
 * the retention settings (ADR-0005), so they are recent counts, not totals;
 * totals come from the database (GET /admin/stats/summary).
 */
@Injectable()
export class QueueMetricsService {
  private readonly queues: Queue[];

  constructor(
    @InjectQueue(QueueNames.EmailTransactional) emailTransactional: Queue,
    @InjectQueue(QueueNames.EmailMarketing) emailMarketing: Queue,
    @InjectQueue(QueueNames.PushTransactional) pushTransactional: Queue,
    @InjectQueue(QueueNames.PushMarketing) pushMarketing: Queue,
    @InjectQueue(QueueNames.Dlq) private readonly dlq: Queue,
  ) {
    this.queues = [
      emailTransactional,
      emailMarketing,
      pushTransactional,
      pushMarketing,
    ];
  }

  async collect(): Promise<QueueMetricsResponse> {
    const queues = await Promise.all(this.queues.map((q) => this.measure(q)));
    // Nothing consumes the DLQ; its jobs stay waiting until a redrive.
    const dlq = (await this.dlq.getJobCounts('waiting')).waiting ?? 0;
    return { queues: sortLike(queues, SEND_QUEUES), dlq };
  }

  /**
   * Stops every worker from picking up new jobs on a send queue, e.g. the
   * marketing queue during a bounce spike. Jobs already running finish;
   * waiting jobs, and new ones added meanwhile, wait in Redis. The pause is
   * kept in Redis, so it survives restarts until resumed.
   */
  async pause(name: string): Promise<QueueMetrics> {
    const queue = this.sendQueue(name);
    await queue.pause();
    return this.measure(queue);
  }

  async resume(name: string): Promise<QueueMetrics> {
    const queue = this.sendQueue(name);
    await queue.resume();
    return this.measure(queue);
  }

  private sendQueue(name: string): Queue {
    const queue = this.queues.find((q) => q.name === name);
    if (!queue) {
      throw new ProblemException(
        ProblemTypes.RESOURCE_NOT_FOUND,
        `${name} is not a send queue.`,
      );
    }
    return queue;
  }

  private async measure(queue: Queue): Promise<QueueMetrics> {
    const [c, paused] = await Promise.all([
      queue.getJobCounts(
        'waiting',
        'prioritized',
        'active',
        'delayed',
        'failed',
        'completed',
      ),
      queue.isPaused(),
    ]);
    return {
      name: queue.name,
      waiting: (c.waiting ?? 0) + (c.prioritized ?? 0),
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
      completed: c.completed ?? 0,
      paused,
    };
  }
}

function sortLike<T extends { name: string }>(
  items: T[],
  order: readonly string[],
): T[] {
  return [...items].sort(
    (a, b) => order.indexOf(a.name) - order.indexOf(b.name),
  );
}

@ApiTags('admin: queues')
@ApiSecurity('admin-key')
@ApiUnauthorizedResponse({ description: 'Missing or wrong X-Admin-Key' })
@Controller('admin/queues')
@UseGuards(AdminKeyGuard)
export class QueueMetricsController {
  constructor(private readonly metrics: QueueMetricsService) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'Job counts per send queue and the DLQ',
    description:
      'From Redis. failed and completed only count jobs still kept (ADR-0005).',
  })
  @ApiOkResponse({ type: QueueMetricsResponse })
  get(): Promise<QueueMetricsResponse> {
    return this.metrics.collect();
  }

  @Post(':name/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pause a send queue for every worker',
    description:
      'Running jobs finish; waiting and new jobs stay queued until resume. Repeating it is harmless.',
  })
  @ApiOkResponse({ type: QueueMetrics })
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  pause(@Param('name') name: string): Promise<QueueMetrics> {
    return this.metrics.pause(name);
  }

  @Post(':name/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused send queue' })
  @ApiOkResponse({ type: QueueMetrics })
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  resume(@Param('name') name: string): Promise<QueueMetrics> {
    return this.metrics.resume(name);
  }
}
