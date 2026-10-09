import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { MoreThan, Repository } from 'typeorm';
import { decodeIdCursor, encodeCursor } from '../../common/pagination/cursor';
import { Dispatcher } from '../../dispatch/dispatcher.service';
import { Notification } from '../../notifications/notification.entity';
import { NotificationStatus } from '../../notifications/notification.enums';
import { NotificationTransitions } from '../../queue/notification-transitions';
import { jobIdFor, QueueNames } from '../../queue/queue.constants';
import {
  DeadNotificationResponse,
  DlqPageResponse,
  ListDlqQuery,
  RedriveResponse,
} from './dto/dlq.dto';

/**
 * The DLQ as operators see it. The list comes from MySQL (status DEAD), the
 * record that counts; the notification-dlq jobs only mirror it for
 * dashboards and are removed on redrive.
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly transitions: NotificationTransitions,
    private readonly dispatcher: Dispatcher,
    @InjectQueue(QueueNames.Dlq) private readonly dlq: Queue,
  ) {}

  async list(query: ListDlqQuery): Promise<DlqPageResponse> {
    const afterId = query.cursor ? decodeIdCursor(query.cursor).id : 0;
    const rows = await this.notifications.find({
      where: { status: NotificationStatus.Dead, id: MoreThan(afterId) },
      relations: { template: true },
      // A second query for the templates, so the page is a plain LIMIT
      // rather than TypeORM's DISTINCT pagination over a join (#83).
      relationLoadStrategy: 'query',
      withDeleted: true,
      order: { id: 'ASC' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((n) => DeadNotificationResponse.from(n)),
      nextCursor:
        rows.length > query.limit
          ? encodeCursor({ id: items[items.length - 1].id })
          : null,
    };
  }

  /**
   * T8 for each id. The conditional update decides: an id that is not DEAD
   * (redriven already, or never dead) is skipped, so repeated or concurrent
   * redrives queue each notification once.
   */
  async redrive(ids: number[]): Promise<RedriveResponse> {
    let redriven = 0;
    const skipped: number[] = [];
    for (const id of ids) {
      if (!(await this.transitions.redrive(id))) {
        skipped.push(id);
        continue;
      }
      redriven += 1;
      const target = await this.notifications.findOneOrFail({
        select: { id: true, channel: true, category: true },
        where: { id },
      });
      // If this fails the notification is QUEUED without a job; the sweeper
      // re-adds stale QUEUED notifications (#45).
      await this.dispatcher.requeue(target);
      await this.dlq.remove(jobIdFor(id)).catch((error: Error) => {
        this.logger.warn(`DLQ job for ${id} not removed: ${error.message}`);
      });
    }
    return { redriven, skipped };
  }
}
