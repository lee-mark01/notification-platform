import type { FieldError } from '../../common/problem/problem.exception';
import type { TemplateContent } from '../template-content.rules';
import { extractVariables, TemplateSyntaxError } from './template-syntax';

// Content fields that may contain placeholders. Push data is sent as-is.
const TEXT_FIELDS = [
  'subject',
  'htmlBody',
  'textBody',
  'title',
  'body',
] as const;

/**
 * Checks that every template field parses, uses only plain placeholders, and
 * that the variables used across all fields are exactly the declared
 * requiredVariables: an undeclared one would fail at send time, and an unused
 * declaration usually means a typo.
 */
export function checkTemplateVariables(
  content: TemplateContent,
  requiredVariables: string[],
): FieldError[] {
  const errors: FieldError[] = [];
  const used = new Set<string>();

  for (const field of TEXT_FIELDS) {
    const source = content[field];
    if (typeof source !== 'string') continue;
    try {
      for (const name of extractVariables(source)) used.add(name);
    } catch (error) {
      if (!(error instanceof TemplateSyntaxError)) throw error;
      errors.push({ field, message: error.message });
    }
  }
  if (errors.length > 0) return errors;

  const declared = new Set(requiredVariables);
  const undeclared = [...used].filter((name) => !declared.has(name));
  const unused = requiredVariables.filter((name) => !used.has(name));
  if (undeclared.length > 0) {
    errors.push({
      field: 'requiredVariables',
      message: `variables used in the template but not declared: ${undeclared.join(', ')}`,
    });
  }
  if (unused.length > 0) {
    errors.push({
      field: 'requiredVariables',
      message: `declared variables not used in the template: ${unused.join(', ')}`,
    });
  }
  return errors;
}
