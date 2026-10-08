import { checkTemplateContent } from './template-content.rules';
import { TemplateChannel } from './template.entity';

describe('checkTemplateContent', () => {
  it('accepts an email template with subject and htmlBody', () => {
    expect(
      checkTemplateContent(TemplateChannel.Email, {
        subject: 'Verify your email',
        htmlBody: '<p>{{code}}</p>',
      }),
    ).toEqual([]);
  });

  it('accepts a push template with title, body, and data', () => {
    expect(
      checkTemplateContent(TemplateChannel.Push, {
        title: 'New message',
        body: 'You have a new message',
        data: { screen: 'inbox' },
      }),
    ).toEqual([]);
  });

  it('requires the channel-specific fields', () => {
    expect(checkTemplateContent(TemplateChannel.Email, {})).toEqual([
      { field: 'subject', message: 'subject is required for email templates' },
      {
        field: 'htmlBody',
        message: 'htmlBody is required for email templates',
      },
    ]);
  });

  it('rejects fields that belong to another channel', () => {
    const errors = checkTemplateContent(TemplateChannel.Push, {
      title: 'Hi',
      body: 'Hello',
      subject: 'Not for push',
      htmlBody: '<p>no</p>',
    });

    expect(errors.map((e) => e.field)).toEqual(['subject', 'htmlBody']);
  });

  it('treats null as absent, so a required field cannot be cleared', () => {
    expect(
      checkTemplateContent(TemplateChannel.Push, { title: null, body: 'b' }),
    ).toEqual([
      { field: 'title', message: 'title is required for push templates' },
    ]);
  });
});
