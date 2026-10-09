import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, LessThan, Not, Repository } from 'typeorm';
import { decodeIdCursor, encodeCursor } from '../common/pagination/cursor';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import {
  ListSuppressionsQuery,
  SuppressionPage,
  SuppressionResponse,
} from './dto/suppression.dto';
import { Suppression, SuppressionReason } from './suppression.entity';

// Addresses are compared case-insensitively. The local part is technically
// case-sensitive, but mail providers treat it as not, and a false match only
// blocks mail to an address that already bounced or complained.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// What suppress() did: a new row, a released row blocked again, or nothing
// because the address was already blocked.
export type SuppressOutcome = 'created' | 'reactivated' | 'unchanged';

@Injectable()
export class SuppressionsService {
  constructor(
    @InjectRepository(Suppression)
    private readonly suppressions: Repository<Suppression>,
  ) {}

  async isSuppressed(email: string): Promise<boolean> {
    return this.suppressions.existsBy({
      email: normalizeEmail(email),
      releasedAt: IsNull(),
    });
  }

  /**
   * Blocks an address. Insert first and fall back to an update on the unique
   * index, so two concurrent calls leave one row. An address already blocked
   * keeps its original reason; a released one is blocked again in the same
   * row.
   */
  async suppress(
    email: string,
    reason: SuppressionReason,
    source: string | null,
  ): Promise<SuppressOutcome> {
    const values = {
      reason,
      source,
      suppressedAt: new Date(),
      releasedAt: null,
    };
    const normalized = normalizeEmail(email);
    try {
      await this.suppressions.insert({ email: normalized, ...values });
      return 'created';
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      const result = await this.suppressions.update(
        { email: normalized, releasedAt: Not(IsNull()) },
        values,
      );
      return result.affected === 1 ? 'reactivated' : 'unchanged';
    }
  }

  /**
   * Unblocks an address; the row stays as a record of the past block.
   * Conditional, so only one of two concurrent releases reports success.
   */
  async release(email: string): Promise<boolean> {
    const result = await this.suppressions.update(
      { email: normalizeEmail(email), releasedAt: IsNull() },
      { releasedAt: new Date() },
    );
    return result.affected === 1;
  }

  // Newest first by id; uq_suppression_email serves the email filter.
  async list(query: ListSuppressionsQuery): Promise<SuppressionPage> {
    const where: FindOptionsWhere<Suppression> = {};
    if (query.email) where.email = normalizeEmail(query.email);
    if (query.reason) where.reason = query.reason;
    if (query.active !== undefined) {
      where.releasedAt = query.active ? IsNull() : Not(IsNull());
    }
    if (query.cursor) where.id = LessThan(decodeIdCursor(query.cursor).id);
    const rows = await this.suppressions.find({
      where,
      order: { id: 'DESC' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((s) => SuppressionResponse.from(s)),
      nextCursor:
        rows.length > query.limit
          ? encodeCursor({ id: items[items.length - 1].id })
          : null,
    };
  }

  findByEmail(email: string): Promise<Suppression | null> {
    return this.suppressions.findOneBy({ email: normalizeEmail(email) });
  }
}
