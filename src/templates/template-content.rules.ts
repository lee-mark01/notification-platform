import type { FieldError } from '../common/problem/problem.exception';
import { TemplateChannel } from './template.entity';

export interface TemplateContent {
  subject?: string | null;
  htmlBody?: string | null;
  textBody?: string | null;
  title?: string | null;
  body?: string | null;
  data?: Record<string, string> | null;
}

type ContentField = keyof TemplateContent;

const FIELDS: Record<
  TemplateChannel,
  { required: ContentField[]; optional: ContentField[] }
> = {
  [TemplateChannel.Email]: {
    required: ['subject', 'htmlBody'],
    optional: ['textBody'],
  },
  [TemplateChannel.Push]: {
    required: ['title', 'body'],
    optional: ['data'],
  },
};

const ALL_FIELDS: ContentField[] = [
  'subject',
  'htmlBody',
  'textBody',
  'title',
  'body',
  'data',
];

const isPresent = (value: unknown) => value !== undefined && value !== null;

/**
 * Checks which content fields a channel requires and allows. Shared by
 * create (channel from the request) and update (channel from the stored
 * template, content merged with the patch). Type and length checks stay in
 * the DTOs.
 */
export function checkTemplateContent(
  channel: TemplateChannel,
  content: TemplateContent,
): FieldError[] {
  const { required, optional } = FIELDS[channel];
  const allowed = new Set([...required, ...optional]);
  const errors: FieldError[] = [];

  for (const field of required) {
    if (!isPresent(content[field])) {
      errors.push({
        field,
        message: `${field} is required for ${channel} templates`,
      });
    }
  }
  for (const field of ALL_FIELDS) {
    if (!allowed.has(field) && isPresent(content[field])) {
      errors.push({
        field,
        message: `${field} is not allowed for ${channel} templates`,
      });
    }
  }
  return errors;
}
