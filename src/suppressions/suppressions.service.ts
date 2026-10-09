import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import { Suppression, SuppressionReason } from './suppression.entity';

// Addresses are compared case-insensitively. The local part is technically
// case-sensitive, but mail providers treat it as not, and a false match only
// blocks mail to an address that already bounced or complained.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

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
  ): Promise<void> {
    const values = {
      reason,
      source,
      suppressedAt: new Date(),
      releasedAt: null,
    };
    const normalized = normalizeEmail(email);
    try {
      await this.suppressions.insert({ email: normalized, ...values });
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      await this.suppressions.update(
        { email: normalized, releasedAt: Not(IsNull()) },
        values,
      );
    }
  }
}
