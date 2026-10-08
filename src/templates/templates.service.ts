import { Injectable } from '@nestjs/common';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import { ifMatchSatisfied } from '../common/http/etag';
import {
  decodeIdCursor,
  encodeCursor,
  Page,
} from '../common/pagination/cursor';
import { ProblemTypes } from '../common/problem/problem-types';
import { ProblemException } from '../common/problem/problem.exception';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ListTemplatesQuery } from './dto/list-templates.query';
import { UpdateTemplateDto } from './dto/update-template.dto';
import {
  checkTemplateContent,
  type TemplateContent,
} from './template-content.rules';
import { checkTemplateVariables } from './rendering/template-variables.rules';
import { Template } from './template.entity';
import { TemplateChanges, TemplatesRepository } from './templates.repository';

@Injectable()
export class TemplatesService {
  constructor(private readonly templates: TemplatesRepository) {}

  async create(dto: CreateTemplateDto): Promise<Template> {
    this.assertContent(dto.channel, dto, dto.requiredVariables ?? []);
    try {
      return await this.templates.insert({
        key: dto.key,
        channel: dto.channel,
        subject: dto.subject ?? null,
        htmlBody: dto.htmlBody ?? null,
        textBody: dto.textBody ?? null,
        title: dto.title ?? null,
        body: dto.body ?? null,
        data: dto.data ?? null,
        requiredVariables: dto.requiredVariables ?? [],
      });
    } catch (error) {
      // The unique index is the real guard: a check-then-insert would race
      // with a concurrent request using the same key.
      if (isDuplicateEntryError(error)) {
        throw new ProblemException(
          ProblemTypes.TEMPLATE_KEY_CONFLICT,
          `Template key "${dto.key}" is already in use, including by deleted templates.`,
        );
      }
      throw error;
    }
  }

  async get(id: number): Promise<Template> {
    const template = await this.templates.findActiveById(id);
    if (!template) {
      throw new ProblemException(
        ProblemTypes.RESOURCE_NOT_FOUND,
        `Template ${id} was not found.`,
      );
    }
    return template;
  }

  /** Active (not deleted) template by key, or null. */
  findActiveByKey(key: string): Promise<Template | null> {
    return this.templates.findActiveByKey(key);
  }

  async list(query: ListTemplatesQuery): Promise<Page<Template>> {
    const afterId = query.cursor ? decodeIdCursor(query.cursor).id : undefined;
    const rows = await this.templates.findPage({
      channel: query.channel,
      afterId,
      limit: query.limit,
    });
    const items = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    return {
      items,
      nextCursor: hasMore ? encodeCursor({ id: items.at(-1)!.id }) : null,
    };
  }

  async update(
    id: number,
    ifMatch: string | undefined,
    dto: UpdateTemplateDto,
  ): Promise<Template> {
    if (!ifMatch) {
      throw new ProblemException(
        ProblemTypes.PRECONDITION_REQUIRED,
        'Send If-Match with the ETag from GET /admin/templates/{id}.',
      );
    }

    const current = await this.get(id);
    if (!ifMatchSatisfied(ifMatch, current.version)) {
      throw this.preconditionFailed(id);
    }

    const changes: TemplateChanges = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    const merged = { ...current, ...changes };
    this.assertContent(current.channel, merged, merged.requiredVariables);
    if (Object.keys(changes).length === 0) return current;

    // The version check is repeated in the UPDATE itself: another request may
    // have changed the row between the read above and this write.
    const updated = await this.templates.updateIfVersion(
      id,
      current.version,
      changes,
    );
    if (!updated) throw this.preconditionFailed(id);
    return this.get(id);
  }

  async remove(id: number): Promise<void> {
    if (!(await this.templates.softDeleteById(id))) {
      throw new ProblemException(
        ProblemTypes.RESOURCE_NOT_FOUND,
        `Template ${id} was not found.`,
      );
    }
  }

  // Channel rules first: placeholders are only checked in fields the channel
  // actually uses.
  private assertContent(
    channel: Template['channel'],
    content: TemplateContent,
    requiredVariables: string[],
  ): void {
    const channelErrors = checkTemplateContent(channel, content);
    if (channelErrors.length > 0) {
      throw new ProblemException(
        ProblemTypes.VALIDATION_FAILED,
        'Template content does not match its channel.',
        { errors: channelErrors },
      );
    }
    const variableErrors = checkTemplateVariables(content, requiredVariables);
    if (variableErrors.length > 0) {
      throw new ProblemException(
        ProblemTypes.VALIDATION_FAILED,
        'Template placeholders do not match requiredVariables.',
        { errors: variableErrors },
      );
    }
  }

  private preconditionFailed(id: number): ProblemException {
    return new ProblemException(
      ProblemTypes.PRECONDITION_FAILED,
      `Template ${id} has changed. Fetch it again and retry with the new ETag.`,
    );
  }
}
