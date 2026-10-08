import { checkTemplateVariables } from './template-variables.rules';

describe('checkTemplateVariables', () => {
  it('accepts content whose variables match the declaration', () => {
    expect(
      checkTemplateVariables(
        { subject: 'Hi {{name}}', htmlBody: '<p>{{code}}</p>' },
        ['name', 'code'],
      ),
    ).toEqual([]);
  });

  it('reports variables used but not declared', () => {
    expect(
      checkTemplateVariables({ subject: 'Hi {{name}}', htmlBody: '{{code}}' }, [
        'name',
      ]),
    ).toEqual([
      {
        field: 'requiredVariables',
        message: 'variables used in the template but not declared: code',
      },
    ]);
  });

  it('reports declared variables that no field uses', () => {
    expect(
      checkTemplateVariables({ title: 'Hi', body: 'there' }, ['nmae']),
    ).toEqual([
      {
        field: 'requiredVariables',
        message: 'declared variables not used in the template: nmae',
      },
    ]);
  });

  it('reports syntax errors per field before comparing variables', () => {
    const errors = checkTemplateVariables(
      { subject: '{{#if a}}x{{/if}}', htmlBody: '{{{raw}}}' },
      ['a', 'raw'],
    );

    expect(errors.map((e) => e.field)).toEqual(['subject', 'htmlBody']);
  });

  it('does not look for placeholders in push data', () => {
    expect(
      checkTemplateVariables(
        { title: 'T', body: 'B', data: { k: '{{x}}' } },
        [],
      ),
    ).toEqual([]);
  });
});
