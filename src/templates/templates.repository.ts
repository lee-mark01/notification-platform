import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Template, TemplateChannel } from './template.entity';

export type NewTemplate = Pick<
  Template,
  | 'key'
  | 'channel'
  | 'subject'
  | 'htmlBody'
  | 'textBody'
  | 'title'
  | 'body'
  | 'data'
  | 'requiredVariables'
>;

export type TemplateChanges = Partial<Omit<NewTemplate, 'key' | 'channel'>>;

// All template queries live here; soft-deleted rows are excluded by
// TypeORM's find methods because of the @DeleteDateColumn.
@Injectable()
export class TemplatesRepository {
  constructor(
    @InjectRepository(Template) private readonly repo: Repository<Template>,
  ) {}

  insert(values: NewTemplate): Promise<Template> {
    return this.repo.save(this.repo.create(values));
  }

  findActiveById(id: number): Promise<Template | null> {
    return this.repo.findOneBy({ id });
  }

  // Fetches one extra row to tell whether another page exists.
  findPage(options: {
    channel?: TemplateChannel;
    afterId?: number;
    limit: number;
  }): Promise<Template[]> {
    return this.repo.find({
      where: {
        ...(options.channel && { channel: options.channel }),
        ...(options.afterId && { id: MoreThan(options.afterId) }),
      },
      order: { id: 'ASC' },
      take: options.limit + 1,
    });
  }

  /**
   * Conditional update: applies only if the row still has `version` and is
   * not deleted, and bumps the version. Returns false when another write got
   * there first, so a concurrent edit is never silently overwritten.
   */
  async updateIfVersion(
    id: number,
    version: number,
    changes: TemplateChanges,
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(Template)
      // Without this TypeORM sets updated_at = CURRENT_TIMESTAMP, dropping the
      // milliseconds of the datetime(3) column.
      .set({ ...changes, updatedAt: () => 'CURRENT_TIMESTAMP(3)' })
      .where('id = :id', { id })
      .andWhere('version = :version', { version })
      .andWhere('deleted_at IS NULL')
      .execute();
    return result.affected === 1;
  }

  async softDeleteById(id: number): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .softDelete()
      .where('id = :id', { id })
      .andWhere('deleted_at IS NULL')
      .execute();
    return result.affected === 1;
  }
}
