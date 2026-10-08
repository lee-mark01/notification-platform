import { DataSource } from 'typeorm';
import { ApiClient } from '../../src/clients/api-client.entity';
import { generateApiKey, hashApiKey } from '../../src/clients/api-key';
import { Template, TemplateChannel } from '../../src/templates/template.entity';
import { AppUser } from '../../src/users/app-user.entity';

export async function seedClient(
  dataSource: DataSource,
  name = 'test-client',
): Promise<{ client: ApiClient; apiKey: string }> {
  const apiKey = generateApiKey();
  const client = await dataSource
    .getRepository(ApiClient)
    .save({ name, apiKeyHash: hashApiKey(apiKey) });
  return { client, apiKey };
}

export function seedUser(
  dataSource: DataSource,
  overrides: Partial<AppUser> = {},
): Promise<AppUser> {
  return dataSource.getRepository(AppUser).save({
    email: `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    marketingOptIn: false,
    marketingOptInAt: null,
    ...overrides,
  });
}

export function seedEmailTemplate(
  dataSource: DataSource,
  overrides: Partial<Template> = {},
): Promise<Template> {
  return dataSource.getRepository(Template).save({
    key: 'email-verification',
    channel: TemplateChannel.Email,
    subject: 'Your code {{code}}',
    htmlBody: '<p>Code: {{code}}</p>',
    textBody: 'Code: {{code}}',
    title: null,
    body: null,
    data: null,
    requiredVariables: ['code'],
    ...overrides,
  });
}

export function seedPushTemplate(
  dataSource: DataSource,
  overrides: Partial<Template> = {},
): Promise<Template> {
  return dataSource.getRepository(Template).save({
    key: 'chat-new-message',
    channel: TemplateChannel.Push,
    subject: null,
    htmlBody: null,
    textBody: null,
    title: '{{sender}}',
    body: '{{sender}}: {{preview}}',
    data: { screen: 'chat' },
    requiredVariables: ['sender', 'preview'],
    ...overrides,
  });
}
