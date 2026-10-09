import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  decodeTimeIdCursor,
  encodeCursor,
} from '../../common/pagination/cursor';
import { Notification } from '../../notifications/notification.entity';
import { resolvePeriod } from '../period';
import {
  NotificationHistoryItem,
  NotificationHistoryPage,
  SearchNotificationsQuery,
} from './history.dto';

/**
 * Operator search over every notification, newest first. The period always
 * applies (default 7 days, at most 92), so each query is a bounded range on
 * created_at rather than a scan of the whole table.
 */
@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  async search(
    query: SearchNotificationsQuery,
    now = new Date(),
  ): Promise<NotificationHistoryPage> {
    const { from, to } = resolvePeriod(query, now);
    const qb = this.notifications
      .createQueryBuilder('n')
      .innerJoinAndSelect('n.template', 't')
      .where('n.created_at >= :from AND n.created_at < :to', { from, to })
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(query.limit + 1);

    if (query.channel) {
      qb.andWhere('n.channel = :channel', { channel: query.channel });
    }
    if (query.category) {
      qb.andWhere('n.category = :category', { category: query.category });
    }
    if (query.status?.length) {
      qb.andWhere('n.status IN (:...status)', { status: query.status });
    }
    if (query.clientId) {
      qb.andWhere('n.client_id = :clientId', { clientId: query.clientId });
    }
    if (query.userId) {
      qb.andWhere('n.user_id = :userId', { userId: query.userId });
    }
    if (query.email) {
      qb.andWhere('n.recipient_email = :email', { email: query.email });
    }
    if (query.templateKey) {
      qb.andWhere('t.key = :templateKey', { templateKey: query.templateKey });
    }
    if (query.cursor) {
      const { at, id } = decodeTimeIdCursor(query.cursor);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('n.created_at < :at', { at })
            .orWhere('(n.created_at = :at AND n.id < :id)', { at, id }),
        ),
      );
    }

    const rows = await qb.getMany();
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items: items.map((n) =>
        NotificationHistoryItem.from(n, n.template?.key ?? ''),
      ),
      nextCursor:
        rows.length > query.limit
          ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }
}
