import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import {
  decodeTimeIdCursor,
  encodeCursor,
} from '../../common/pagination/cursor';
import { Notification } from '../../notifications/notification.entity';
import { Template } from '../../templates/template.entity';
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
 *
 * The page is one table, no join (#83): ix_notification_created_at is
 * (created_at, id), so MySQL reads the range backwards and stops after
 * limit + 1 matching rows. With a join to template it hash-joined and sorted
 * every row in the period instead (77,825 rows for 7 days of 1M: 306 ms vs
 * under 1 ms). Template keys come from a second query over a few ids.
 */
@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(Template)
    private readonly templates: Repository<Template>,
  ) {}

  async search(
    query: SearchNotificationsQuery,
    now = new Date(),
  ): Promise<NotificationHistoryPage> {
    const { from, to } = resolvePeriod(query, now);
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.created_at >= :from AND n.created_at < :to', { from, to })
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .limit(query.limit + 1);

    if (query.templateKey) {
      // Deleted templates included: their notifications are still history.
      const template = await this.templates.findOne({
        select: { id: true },
        where: { key: query.templateKey },
        withDeleted: true,
      });
      if (!template) return { items: [], nextCursor: null };
      qb.andWhere('n.template_id = :templateId', { templateId: template.id });
    }
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
    const keys = await this.templateKeys(items.map((n) => n.templateId));
    const last = items[items.length - 1];
    return {
      items: items.map((n) =>
        NotificationHistoryItem.from(n, keys.get(n.templateId) ?? ''),
      ),
      nextCursor:
        rows.length > query.limit
          ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async templateKeys(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const templates = await this.templates.find({
      select: { id: true, key: true },
      where: { id: In([...new Set(ids)]) },
      withDeleted: true,
    });
    return new Map(templates.map((t) => [t.id, t.key]));
  }
}
