import {
  renderTemplate,
  type TemplateVariables,
} from '../templates/rendering/template-renderer';
import { Template, TemplateChannel } from '../templates/template.entity';
import type { Notification } from './notification.entity';

export const MAX_TITLE_LENGTH = 255;

export type RenderedFields = Pick<
  Notification,
  'renderedTitle' | 'renderedBody' | 'renderedText' | 'renderedData'
>;

/**
 * Renders a template into the columns a notification stores, so what is
 * stored is exactly what will be sent. Returns null when the rendered title
 * does not fit; callers report that as the request's fault.
 */
export function renderedFields(
  template: Template,
  variables: TemplateVariables,
): RenderedFields | null {
  const rendered = renderTemplate(template, variables);
  const title =
    rendered.channel === TemplateChannel.Email
      ? rendered.subject
      : rendered.title;
  if (title.length > MAX_TITLE_LENGTH) return null;
  return {
    renderedTitle: title,
    renderedBody:
      rendered.channel === TemplateChannel.Email
        ? rendered.html
        : rendered.body,
    renderedText:
      rendered.channel === TemplateChannel.Email ? rendered.text : null,
    renderedData:
      rendered.channel === TemplateChannel.Push ? rendered.data : null,
  };
}
