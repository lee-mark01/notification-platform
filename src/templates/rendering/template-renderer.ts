import Handlebars from 'handlebars';
import { Template, TemplateChannel } from '../template.entity';

export type VariableValue = string | number | boolean;
export type TemplateVariables = Record<string, VariableValue>;

export interface RenderedEmail {
  channel: TemplateChannel.Email;
  subject: string;
  html: string;
  text: string | null;
}

export interface RenderedPush {
  channel: TemplateChannel.Push;
  title: string;
  body: string;
  data: Record<string, string> | null;
}

export type RenderedContent = RenderedEmail | RenderedPush;

export class MissingVariablesError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing template variables: ${missing.join(', ')}`);
  }
}

/** Required variables of the template that the caller did not supply. */
export function missingVariables(
  template: Pick<Template, 'requiredVariables'>,
  variables: TemplateVariables,
): string[] {
  return template.requiredVariables.filter(
    (name) => !Object.prototype.hasOwnProperty.call(variables, name),
  );
}

type Compiled = (variables: TemplateVariables) => string;

// Compiling costs far more than rendering: a 10,000-recipient batch spent
// most of its intake time compiling the same three sources. Keyed by source,
// so an edited template is a new entry; cleared when full rather than LRU,
// since the number of live templates is small.
const MAX_COMPILED = 500;
const compiled = new Map<string, Compiled>();

// strict: a placeholder without a value throws instead of rendering empty.
// HTML bodies are escaped; subjects, plain text, and push text are not HTML.
function render(source: string, variables: TemplateVariables, html: boolean) {
  const key = `${html ? 'h' : 't'}:${source}`;
  let fn = compiled.get(key);
  if (!fn) {
    if (compiled.size >= MAX_COMPILED) compiled.clear();
    fn = Handlebars.compile<TemplateVariables>(source, {
      strict: true,
      knownHelpersOnly: true,
      noEscape: !html,
    });
    compiled.set(key, fn);
  }
  return fn(variables);
}

/**
 * Renders a template's channel content with the given variables. Push data
 * values are sent as-is; only titles and bodies contain placeholders.
 */
export function renderTemplate(
  template: Template,
  variables: TemplateVariables,
): RenderedContent {
  const missing = missingVariables(template, variables);
  if (missing.length > 0) throw new MissingVariablesError(missing);

  if (template.channel === TemplateChannel.Email) {
    return {
      channel: TemplateChannel.Email,
      subject: render(template.subject ?? '', variables, false),
      html: render(template.htmlBody ?? '', variables, true),
      text: template.textBody
        ? render(template.textBody, variables, false)
        : null,
    };
  }
  return {
    channel: TemplateChannel.Push,
    title: render(template.title ?? '', variables, false),
    body: render(template.body ?? '', variables, false),
    data: template.data,
  };
}
