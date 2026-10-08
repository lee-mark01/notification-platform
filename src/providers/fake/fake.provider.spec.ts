import { ConfigService } from '@nestjs/config';
import { TemplateChannel } from '../../templates/template.entity';
import { type EmailMessage, ProviderError } from '../notification-provider';
import { FakeProvider } from './fake.provider';

const message: EmailMessage = {
  channel: TemplateChannel.Email,
  notificationId: 1,
  to: 'a@example.com',
  subject: 's',
  html: '<p>h</p>',
  text: 'h',
};

describe('FakeProvider', () => {
  let fake: FakeProvider;

  beforeEach(() => {
    fake = new FakeProvider(new ConfigService({ FAKE_PROVIDER_LATENCY_MS: 0 }));
  });

  it('records successful sends', async () => {
    const result = await fake.send(message);

    expect(result.providerMessageId).toMatch(/^fake-/);
    expect(fake.sent).toEqual([message]);
  });

  it('plays scripted outcomes in order, then succeeds', async () => {
    fake.script(
      { kind: 'transient', code: 'THROTTLED' },
      { kind: 'permanent', code: 'INVALID_ADDRESS' },
    );

    await expect(fake.send(message)).rejects.toMatchObject({
      code: 'THROTTLED',
      transient: true,
    });
    await expect(fake.send(message)).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
      transient: false,
    });
    await expect(fake.send(message)).resolves.toBeDefined();
    expect(fake.sent).toHaveLength(1);
  });

  it('fails every send at failure rate 1', async () => {
    fake.failureRate = 1;

    await expect(fake.send(message)).rejects.toBeInstanceOf(ProviderError);
    expect(fake.sent).toHaveLength(0);
  });
});
