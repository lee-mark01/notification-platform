import { extractVariables, TemplateSyntaxError } from './template-syntax';

describe('extractVariables', () => {
  it('returns plain placeholders in order of first use, without duplicates', () => {
    expect(
      extractVariables('Hi {{name}}, your code is {{code}}. Bye {{name}}.'),
    ).toEqual(['name', 'code']);
  });

  it('ignores text and comments', () => {
    expect(extractVariables('No variables {{!-- note --}} here')).toEqual([]);
  });

  it.each([
    ['a block', '{{#if vip}}VIP{{/if}}'],
    ['a helper call', '{{lookup user name}}'],
    ['hash arguments', '{{name size=2}}'],
    ['a nested path', '{{user.name}}'],
    ['a parent path', '{{../name}}'],
    ['a data variable', '{{@index}}'],
    ['a partial', '{{> footer}}'],
    ['unescaped output', '{{{name}}}'],
    ['this', '{{this}}'],
    ['a built-in helper name', '{{log}}'],
    ['invalid syntax', 'Hi {{name'],
  ])('rejects %s', (_label, source) => {
    expect(() => extractVariables(source)).toThrow(TemplateSyntaxError);
  });
});
