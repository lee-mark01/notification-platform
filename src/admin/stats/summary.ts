import { Controller, Get, Injectable, Query, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';
import { Repository } from 'typeorm';
import { ApiProblemResponse } from '../../common/problem/problem-details.dto';
import { ProblemTypes } from '../../common/problem/problem-types';
import { Notification } from '../../notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../notifications/notification.enums';
import { TemplateChannel } from '../../templates/template.entity';
import { AdminKeyGuard } from '../admin-key.guard';
import { resolvePeriod } from '../period';

const S = NotificationStatus;
// The provider took it and it was not bounced. A complaint means it arrived.
const SUCCEEDED = [S.Sent, S.Delivered, S.Complained];
const FAILED = [S.Bounced, S.Failed, S.Dead];
// Reached the provider: the base for the read rate, as in read-rates.
const REACHED = [S.Sent, S.Delivered, S.Bounced, S.Complained];
// Not finished yet; in neither rate.
const IN_FLIGHT = [S.Pending, S.Queued, S.Sending, S.Retrying];

const GROUP_FIELDS = ['channel', 'category'] as const;
type GroupField = (typeof GROUP_FIELDS)[number];

export class StatsSummaryQuery {
  @ApiPropertyOptional({
    description: 'Start (inclusive). Default: 7 days before to',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'End (exclusive). Default: now' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({
    description:
      'Comma-separated: channel, category, or both. Default: one total',
    example: 'channel,category',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? [...new Set(value.split(',').map((s) => s.trim()))]
      : value,
  )
  @IsIn(GROUP_FIELDS, { each: true })
  groupBy?: GroupField[];
}

export class StatsSummaryItem {
  @ApiPropertyOptional({
    enum: TemplateChannel,
    description: 'When grouped by channel',
  })
  channel?: TemplateChannel;

  @ApiPropertyOptional({
    enum: NotificationCategory,
    description: 'When grouped by category',
  })
  category?: NotificationCategory;

  @ApiProperty({ example: 1200 })
  total: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: {
      SENT: 900,
      DELIVERED: 200,
      FAILED: 30,
      SUPPRESSED: 50,
      QUEUED: 20,
    },
    description: 'Statuses with none are left out',
  })
  byStatus: Record<string, number>;

  @ApiProperty({
    example: 20,
    description: 'PENDING, QUEUED, SENDING, RETRYING',
  })
  inFlight: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 0.9735,
    description:
      '(SENT + DELIVERED + COMPLAINED) / that + (BOUNCED + FAILED + DEAD). SUPPRESSED and in-flight are left out; null when there is nothing finished',
  })
  successRate: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 0.41,
    description:
      'Read / reached the provider (SENT, DELIVERED, BOUNCED, COMPLAINED)',
  })
  readRate: number | null;
}

export class StatsSummaryResponse {
  @ApiProperty()
  from: Date;

  @ApiProperty()
  to: Date;

  @ApiProperty({ type: [String], example: ['channel'] })
  groupBy: GroupField[];

  @ApiProperty({ type: [StatsSummaryItem] })
  items: StatsSummaryItem[];
}

interface Row {
  channel?: TemplateChannel;
  category?: NotificationCategory;
  status: NotificationStatus;
  count: string;
  read: string;
}

/**
 * Counts per status, success rate and read rate for notifications created in
 * a period, in total or per channel and/or category. One GROUP BY over the
 * period; the rates are derived here so their definitions live in one place.
 */
@Injectable()
export class StatsSummaryService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  async compute(
    query: StatsSummaryQuery,
    now = new Date(),
  ): Promise<StatsSummaryResponse> {
    const { from, to } = resolvePeriod(query, now);
    // Fixed order, whatever order the caller wrote them in.
    const groupBy = GROUP_FIELDS.filter((f) => query.groupBy?.includes(f));

    const qb = this.notifications
      .createQueryBuilder('n')
      .select('n.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(n.read_at IS NOT NULL)', 'read')
      .where('n.created_at >= :from AND n.created_at < :to', { from, to })
      .groupBy('n.status');
    for (const field of groupBy) {
      qb.addSelect(`n.${field}`, field).addGroupBy(`n.${field}`);
    }
    const rows = await qb.getRawMany<Row>();

    const groups = new Map<string, { key: Partial<Row>; rows: Row[] }>();
    for (const row of rows) {
      const key: Partial<Row> = Object.fromEntries(
        groupBy.map((f) => [f, row[f]]),
      );
      const id = JSON.stringify(key);
      const group = groups.get(id) ?? { key, rows: [] as Row[] };
      group.rows.push(row);
      groups.set(id, group);
    }

    const items = [...groups.values()].map(({ key, rows: groupRows }) => {
      const byStatus: Record<string, number> = {};
      let read = 0;
      for (const r of groupRows) {
        byStatus[r.status] = Number(r.count);
        if (REACHED.includes(r.status)) read += Number(r.read);
      }
      const sum = (statuses: NotificationStatus[]) =>
        statuses.reduce((acc, s) => acc + (byStatus[s] ?? 0), 0);
      const succeeded = sum(SUCCEEDED);
      const finished = succeeded + sum(FAILED);
      const reached = sum(REACHED);
      return {
        ...key,
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        inFlight: sum(IN_FLIGHT),
        successRate: ratio(succeeded, finished),
        readRate: ratio(read, reached),
      };
    });
    items.sort((a, b) =>
      `${a.channel ?? ''}/${a.category ?? ''}`.localeCompare(
        `${b.channel ?? ''}/${b.category ?? ''}`,
      ),
    );
    return { from, to, groupBy, items };
  }
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 10_000) / 10_000;
}

@ApiTags('admin: stats')
@ApiSecurity('admin-key')
@ApiUnauthorizedResponse({ description: 'Missing or wrong X-Admin-Key' })
@Controller('admin/stats')
@UseGuards(AdminKeyGuard)
export class StatsSummaryController {
  constructor(private readonly summary: StatsSummaryService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Counts by status, success rate and read rate',
    description:
      'For notifications created in the period (at most 92 days, default the last 7).',
  })
  @ApiOkResponse({ type: StatsSummaryResponse })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  get(@Query() query: StatsSummaryQuery): Promise<StatsSummaryResponse> {
    return this.summary.compute(query);
  }
}
