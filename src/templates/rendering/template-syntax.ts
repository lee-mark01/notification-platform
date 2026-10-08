import Handlebars from 'handlebars';

export class TemplateSyntaxError extends Error {}

const VARIABLE_HINT = 'Only {{variable}} placeholders are supported.';

// Handlebars resolves these names to built-in helpers even without arguments,
// so a variable with one of them would silently call the helper instead.
const BUILT_IN_HELPERS = new Set(Object.keys(Handlebars.helpers));

/**
 * Returns the variable names a template uses, in order of first use.
 *
 * Templates are limited to plain `{{name}}` placeholders: no blocks, helpers,
 * partials, paths, or triple-stash `{{{raw}}}` output. Admins write templates
 * but callers supply the values, so keeping the language this small means
 * every variable a template can read is known up front and HTML output is
 * always escaped.
 */
export function extractVariables(source: string): string[] {
  let program: hbs.AST.Program;
  try {
    program = Handlebars.parse(source);
  } catch (error) {
    throw new TemplateSyntaxError(
      `Template does not parse: ${(error as Error).message.split('\n')[0]}`,
    );
  }

  const names = new Set<string>();
  for (const statement of program.body) {
    switch (statement.type) {
      case 'ContentStatement':
      case 'CommentStatement':
        break;
      case 'MustacheStatement':
        names.add(variableName(statement as hbs.AST.MustacheStatement));
        break;
      default:
        throw new TemplateSyntaxError(
          `${statement.type} is not allowed. ${VARIABLE_HINT}`,
        );
    }
  }
  return [...names];
}

function variableName(mustache: hbs.AST.MustacheStatement): string {
  const path = mustache.path as Partial<hbs.AST.PathExpression>;
  const isPlainVariable =
    path.type === 'PathExpression' &&
    path.data === false &&
    path.depth === 0 &&
    path.parts?.length === 1 &&
    mustache.params.length === 0 &&
    mustache.hash === undefined;

  if (!isPlainVariable) {
    throw new TemplateSyntaxError(
      `"{{${String(path.original)}...}}" is not allowed. ${VARIABLE_HINT}`,
    );
  }
  if (!mustache.escaped) {
    throw new TemplateSyntaxError(
      `"{{{${String(path.original)}}}}" (unescaped output) is not allowed. ${VARIABLE_HINT}`,
    );
  }
  const name = path.parts![0];
  if (BUILT_IN_HELPERS.has(name)) {
    throw new TemplateSyntaxError(
      `"${name}" is a reserved helper name and cannot be a variable.`,
    );
  }
  return name;
}
