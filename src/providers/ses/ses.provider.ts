import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type {
  EmailMessage,
  NotificationProvider,
  OutboundMessage,
  SendResult,
} from '../notification-provider';
import { ProviderError } from '../notification-provider';
import { TemplateChannel } from '../../templates/template.entity';
import { classifySesError } from './ses-errors';

export interface SesSettings {
  region: string;
  fromAddress: string;
  // Omitted in deployments that use an IAM role; the SDK's default chain
  // then finds credentials.
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

// Well under the worker's 60 s lease, so a hung call fails before another
// worker may re-claim the notification.
export const SES_CONNECTION_TIMEOUT_MS = 3_000;
export const SES_REQUEST_TIMEOUT_MS = 10_000;

/** Sends email through the SES v2 SendEmail API. */
export class SesProvider implements NotificationProvider {
  readonly name = 'ses';

  constructor(
    private readonly settings: SesSettings,
    private readonly client: SESv2Client = createSesClient(settings),
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    if (message.channel !== TemplateChannel.Email) {
      throw new ProviderError(
        'UNSUPPORTED_CHANNEL',
        false,
        `SES cannot send ${message.channel}`,
      );
    }
    try {
      const output = await this.client.send(this.command(message));
      if (!output.MessageId) {
        throw new ProviderError(
          'MISSING_MESSAGE_ID',
          true,
          'SES accepted the request but returned no MessageId',
        );
      }
      return { providerMessageId: output.MessageId };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw classifySesError(error);
    }
  }

  private command(message: EmailMessage): SendEmailCommand {
    const utf8 = (data: string) => ({ Data: data, Charset: 'UTF-8' });
    return new SendEmailCommand({
      FromEmailAddress: this.settings.fromAddress,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: utf8(message.subject),
          Body: {
            Html: utf8(message.html),
            ...(message.text !== null && { Text: utf8(message.text) }),
          },
        },
      },
    });
  }
}

function createSesClient(settings: SesSettings): SESv2Client {
  return new SESv2Client({
    region: settings.region,
    credentials: settings.credentials,
    // One HTTP attempt per job attempt: retries belong to the queue, so each
    // try is recorded in delivery_attempt and backs off with jitter there.
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: SES_CONNECTION_TIMEOUT_MS,
      requestTimeout: SES_REQUEST_TIMEOUT_MS,
    },
  });
}
