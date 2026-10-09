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
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';
import { Repository } from 'typeorm';
import { ApiProblemResponse } from '../../common/problem/problem-details.dto';
import { ProblemTypes } from '../../common/problem/problem-types';
import { Notification } from '../../notifications/notification.entity';
import { NotificationStatus } from '../../notifications/notification.enums';
import { TemplateChannel } from '../../templates/template.entity';
import { AdminKeyGuard } from '../admin-key.guard';
import { resolvePeriod } from '../period';

// Reached the provider; the base for a read rate.
const SENT = [
  NotificationStatus.Sent,
  NotificationStatus.Delivered,
  NotificationStatus.Bounced,
  NotificationStatus.Complained,
];

export class ReadRatesQuery {
  @ApiPropertyOptional({
    description: 'Start (inclusive). Default: 7 days ago',
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
}

export class ReadRate {
  @ApiProperty({ example: 'chat-new-message' })
  templateKey: string;

  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiProperty({ example: 120 })
  sent: number;

  @ApiProperty({ example: 48 })
  read: number;

  @ApiProperty({ example: 0.4, description: 'read / sent, 4 decimals' })
  readRate: number;
}

export class ReadRatesResponse {
  @ApiProperty()
  from: Date;

  @ApiProperty()
  to: Date;

  @ApiProperty({ type: [ReadRate] })
  items: ReadRate[];
}

/**
 * Read rate per template and channel for notifications created in a period.
 * "Read" is a push click or the inbox for push, and the first SES Open event
 * for email, which is approximate: images blocked by the mail app hide opens,
 * and apps that prefetch images report opens that never happened.
 */
@Injectable()
export class ReadRatesService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  async compute(
    query: ReadRatesQuery,
    now = new Date(),
  ): Promise<ReadRatesResponse> {
    const { from, to } = resolvePeriod(query, now);

    const rows = await this.notifications
      .createQueryBuilder('n')
      .innerJoin('n.template', 't')
      .select('t.key', 'templateKey')
      .addSelect('n.channel', 'channel')
      .addSelect('COUNT(*)', 'sent')
      .addSelect('SUM(n.read_at IS NOT NULL)', 'read')
      .where('n.created_at >= :from AND n.created_at < :to', { from, to })
      .andWhere('n.status IN (:...sent)', { sent: SENT })
      .groupBy('t.key')
      .addGroupBy('n.channel')
      .orderBy('sent', 'DESC')
      .addOrderBy('t.key', 'ASC')
      .getRawMany<{
        templateKey: string;
        channel: TemplateChannel;
        sent: string;
        read: string;
      }>();

    return {
      from,
      to,
      items: rows.map((r) => {
        const sent = Number(r.sent);
        const read = Number(r.read);
        return {
          templateKey: r.templateKey,
          channel: r.channel,
          sent,
          read,
          readRate:
            sent === 0 ? 0 : Math.round((read / sent) * 10_000) / 10_000,
        };
      }),
    };
  }
}

@ApiTags('admin: stats')
@ApiSecurity('admin-key')
@ApiUnauthorizedResponse({ description: 'Missing or wrong X-Admin-Key' })
@Controller('admin/stats')
@UseGuards(AdminKeyGuard)
export class ReadRatesController {
  constructor(private readonly readRates: ReadRatesService) {}

  @Get('read-rates')
  @ApiOperation({ summary: 'Read rate per template and channel' })
  @ApiOkResponse({ type: ReadRatesResponse })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  get(@Query() query: ReadRatesQuery): Promise<ReadRatesResponse> {
    return this.readRates.compute(query);
  }
}
