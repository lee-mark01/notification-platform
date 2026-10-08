import { TemplateFields } from './template-fields';

// key and channel are immutable: they are not declared here, so the global
// ValidationPipe rejects them as unknown properties. null clears an optional
// field; required fields cannot be cleared.
export class UpdateTemplateDto {
  @TemplateFields.subject()
  subject?: string | null;

  @TemplateFields.htmlBody()
  htmlBody?: string | null;

  @TemplateFields.textBody()
  textBody?: string | null;

  @TemplateFields.title()
  title?: string | null;

  @TemplateFields.body()
  body?: string | null;

  @TemplateFields.data()
  data?: Record<string, string> | null;

  @TemplateFields.requiredVariables()
  requiredVariables?: string[];
}
