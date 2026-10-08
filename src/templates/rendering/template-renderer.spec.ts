import { Template, TemplateChannel } from '../template.entity';
import {
  MissingVariablesError,
  missingVariables,
  renderTemplate,
} from './template-renderer';

function template(overrides: Partial<Template>): Template {
  return {
    id: 1,
    key: 'k',
    channel: TemplateChannel.Email,
    subject: null,
    htmlBody: null,
    textBody: null,
    title: null,
    body: null,
    data: null,
    requiredVariables: [],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('renderTemplate', () => {
  const email = template({
    channel: TemplateChannel.Email,
    subject: 'Welcome {{name}}',
    htmlBody: '<p>Hi {{name}}, code {{code}}</p>',
    textBody: 'Hi {{name}}, code {{code}}',
    requiredVariables: ['name', 'code'],
  });

  it('renders every email field', () => {
    expect(renderTemplate(email, { name: 'Lee', code: 381920 })).toEqual({
      channel: 'email',
      subject: 'Welcome Lee',
      html: '<p>Hi Lee, code 381920</p>',
      text: 'Hi Lee, code 381920',
    });
  });

  it('escapes HTML in the HTML body only', () => {
    const rendered = renderTemplate(email, {
      name: '<script>x</script>',
      code: '1',
    });

    expect(rendered).toMatchObject({
      subject: 'Welcome <script>x</script>',
      html: '<p>Hi &lt;script&gt;x&lt;/script&gt;, code 1</p>',
      text: 'Hi <script>x</script>, code 1',
    });
  });

  it('renders push title and body and passes data through unchanged', () => {
    const push = template({
      channel: TemplateChannel.Push,
      title: '{{sender}}',
      body: '{{sender}} & co sent "{{text}}"',
      data: { screen: '{{not-rendered}}' },
      requiredVariables: ['sender', 'text'],
    });

    expect(renderTemplate(push, { sender: 'Kim', text: 'hi' })).toEqual({
      channel: 'push',
      title: 'Kim',
      body: 'Kim & co sent "hi"',
      data: { screen: '{{not-rendered}}' },
    });
  });

  it('reports every missing required variable', () => {
    expect(() => renderTemplate(email, { name: 'Lee' })).toThrow(
      new MissingVariablesError(['code']),
    );
    expect(missingVariables(email, {})).toEqual(['name', 'code']);
  });

  it('does not treat inherited properties as supplied variables', () => {
    const t = template({ requiredVariables: ['constructor'] });

    expect(missingVariables(t, {})).toEqual(['constructor']);
  });
});
