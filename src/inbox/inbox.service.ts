import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Not, Repository } from 'typeorm';
import { decodeTimeIdCursor, encodeCursor } from '../common/pagination/cursor';
import { ProblemTypes } from '../common/problem/problem-types';
import { ProblemException } from '../common/problem/problem.exception';
import { Notification } from '../notifications/notification.entity';
import { NotificationStatus } from '../notifications/notification.enums';
import { AppUser } from '../users/app-user.entity';
import {
  InboxItem,
  InboxPage,
  ListInboxQuery,
  ReadAllResult,
  ReadState,
  UnreadCount,
} from './dto/inbox.dto';

// The inbox shows what actually reached the provider. Suppressed, failed or
// still-queued notifications were never sent to the user.
const VISIBLE = [NotificationStatus.Sent, NotificationStatus.Delivered];

/**
 * A user's own notifications. Read state is a column, not a status
 * (docs/design/state-machine.md), and each change is a conditional UPDATE:
 * marking read only touches rows with read_at IS NULL, so repeating the
 * request keeps the first read time (scenario 12).
 */
@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  // Uses ix_notification_user_created (user_id, created_at, id).
  async list(user: AppUser, query: ListInboxQuery): Promise<InboxPage> {
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId: user.id })
      .andWhere('n.status IN (:...visible)', { visible: VISIBLE })
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(query.limit + 1);
    if (query.unread) qb.andWhere('n.read_at IS NULL');
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
      items: items.map((n) => InboxItem.from(n)),
      nextCursor:
        rows.length > query.limit
          ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  // Uses ix_notification_user_read (user_id, read_at).
  async unreadCount(user: AppUser): Promise<UnreadCount> {
    const count = await this.notifications.countBy({
      userId: user.id,
      readAt: IsNull(),
      status: In(VISIBLE),
    });
    return { count };
  }

  async markRead(user: AppUser, id: number): Promise<ReadState> {
    await this.mine(user, id);
    await this.notifications.update(
      { id, userId: user.id, readAt: IsNull() },
      { readAt: new Date() },
    );
    return this.state(id);
  }

  async markUnread(user: AppUser, id: number): Promise<ReadState> {
    await this.mine(user, id);
    await this.notifications.update(
      { id, userId: user.id, readAt: Not(IsNull()) },
      { readAt: null },
    );
    return this.state(id);
  }

  async markAllRead(user: AppUser): Promise<ReadAllResult> {
    const result = await this.notifications.update(
      { userId: user.id, readAt: IsNull(), status: In(VISIBLE) },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  // Someone else's notification, or one not in the inbox, is reported as
  // missing rather than forbidden.
  private async mine(user: AppUser, id: number): Promise<void> {
    const found = await this.notifications.existsBy({
      id,
      userId: user.id,
      status: In(VISIBLE),
    });
    if (!found) {
      throw new ProblemException(
        ProblemTypes.RESOURCE_NOT_FOUND,
        `Notification ${id} was not found.`,
      );
    }
  }

  private async state(id: number): Promise<ReadState> {
    const { readAt } = await this.notifications.findOneOrFail({
      select: { id: true, readAt: true },
      where: { id },
    });
    return { id, readAt };
  }
}
