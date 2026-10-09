import {
  MessageRejected,
  SendEmailCommand,
  SESv2Client,
  TooManyRequestsException,
} from '@aws-sdk/client-sesv2';
import { TemplateChannel } from '../../templates/template.entity';
import type { EmailMessage, PushMessage } from '../notification-provider';
import { ProviderError } from '../notification-provider';
import { classifySesError } from './ses-errors';
import { SesProvider } from './ses.provider';

const email: EmailMessage = {
  channel: TemplateChannel.Email,
  notificationId: 7,
  to: 'success@simulator.amazonses.com',
  subject: '인증 코드 381920',
  html: '<p>코드: 381920</p>',
  text: '코드: 381920',
};

function namedError(name: string): Error {
  const error = new Error(`${name} happened`);
  error.name = name;
  return error;
}

describe('classifySesError', () => {
  it.each([
    'TooManyRequestsException',
    'LimitExceededException',
    'InternalServiceErrorException',
    'AccountSuspendedException',
    'SendingPausedException',
    'MailFromDomainNotVerifiedException',
    'NotFoundException',
    'TimeoutError',
    'ECONNRESET',
  ])('treats %s as transient', (name) => {
    expect(classifySesError(namedError(name))).toMatchObject({
      code: name,
      transient: true,
    });
  });

  it.each(['MessageRejected', 'BadRequestException'])(
    'treats %s as permanent',
    (name) => {
      expect(classifySesError(namedError(name))).toMatchObject({
        code: name,
        transient: false,
      });
    },
  );

  it('flags a bad request about the address as an invalid recipient', () => {
    const illegal = namedError('BadRequestException');
    illegal.message = 'Illegal address';
    const other = namedError('BadRequestException');
    other.message = 'Missing required parameter';
    const sandbox = namedError('MessageRejected');
    sandbox.message = 'Email address is not verified.';

    expect(classifySesError(illegal).invalidRecipient).toBe(true);
    expect(classifySesError(other).invalidRecipient).toBe(false);
    // A sandbox restriction on our account, not a bad address.
    expect(classifySesError(sandbox).invalidRecipient).toBe(false);
  });

  it('recognizes the SDK exception classes by name', () => {
    const rejected = new MessageRejected({
      message: 'Email address is not verified.',
      $metadata: {},
    });
    const throttled = new TooManyRequestsException({
      message: 'Too many requests',
      $metadata: {},
    });

    expect(classifySesError(rejected).transient).toBe(false);
    expect(classifySesError(throttled).transient).toBe(true);
  });
});

describe('SesProvider', () => {
  const settings = {
    region: 'ap-northeast-2',
    fromAddress: 'sender@example.com',
  };
  let client: SESv2Client;
  let send: jest.SpyInstance;
  let provider: SesProvider;

  beforeEach(() => {
    client = new SESv2Client({ region: settings.region });
    send = jest.spyOn(client, 'send');
    provider = new SesProvider(settings, client);
  });

  const sentCommand = () =>
    (send.mock.calls as unknown[][])[0][0] as SendEmailCommand;

  it('sends a UTF-8 HTML and text email and returns the MessageId', async () => {
    send.mockResolvedValue({ MessageId: 'ses-123', $metadata: {} });

    await expect(provider.send(email)).resolves.toEqual({
      providerMessageId: 'ses-123',
    });

    const command = sentCommand();
    expect(command.input).toEqual({
      FromEmailAddress: 'sender@example.com',
      Destination: { ToAddresses: ['success@simulator.amazonses.com'] },
      Content: {
        Simple: {
          Subject: { Data: '인증 코드 381920', Charset: 'UTF-8' },
          Body: {
            Html: { Data: '<p>코드: 381920</p>', Charset: 'UTF-8' },
            Text: { Data: '코드: 381920', Charset: 'UTF-8' },
          },
        },
      },
    });
  });

  it('names the configuration set when one is configured', async () => {
    const withSet = new SesProvider(
      { ...settings, configurationSet: 'events' },
      client,
    );
    send.mockResolvedValue({ MessageId: 'ses-2', $metadata: {} });

    await withSet.send(email);

    expect(sentCommand().input.ConfigurationSetName).toBe('events');
  });

  it('omits the text part when there is none', async () => {
    send.mockResolvedValue({ MessageId: 'ses-1', $metadata: {} });

    await provider.send({ ...email, text: null });

    const command = sentCommand();
    expect(command.input.Content?.Simple?.Body).toEqual({
      Html: { Data: '<p>코드: 381920</p>', Charset: 'UTF-8' },
    });
  });

  it('maps SDK errors to classified provider errors', async () => {
    send.mockRejectedValue(
      new MessageRejected({ message: 'rejected', $metadata: {} }),
    );

    await expect(provider.send(email)).rejects.toMatchObject({
      code: 'MessageRejected',
      transient: false,
    });
  });

  it('refuses push messages without calling SES', async () => {
    const push: PushMessage = {
      channel: TemplateChannel.Push,
      notificationId: 1,
      userId: 1,
      title: 't',
      body: 'b',
      data: null,
    };

    await expect(provider.send(push)).rejects.toBeInstanceOf(ProviderError);
    expect(send).not.toHaveBeenCalled();
  });
});
