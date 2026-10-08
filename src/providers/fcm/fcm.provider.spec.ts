import type {
  BatchResponse,
  Messaging,
  MulticastMessage,
  SendResponse,
} from 'firebase-admin/messaging';
import type { Repository } from 'typeorm';
import type { DeviceToken } from '../../devices/device-token.entity';
import { TemplateChannel } from '../../templates/template.entity';
import type { PushMessage } from '../notification-provider';
import { isTransientFcmCode } from './fcm-errors';
import { FcmProvider } from './fcm.provider';

const push: PushMessage = {
  channel: TemplateChannel.Push,
  notificationId: 42,
  userId: 7,
  title: 'Kim',
  body: 'Kim: hello',
  data: { screen: 'chat' },
};

const ok = (messageId: string): SendResponse => ({ success: true, messageId });
const fail = (code: string): SendResponse =>
  ({ success: false, error: { code } }) as unknown as SendResponse;

function batch(responses: SendResponse[]): BatchResponse {
  const successCount = responses.filter((r) => r.success).length;
  return {
    responses,
    successCount,
    failureCount: responses.length - successCount,
  };
}

describe('isTransientFcmCode', () => {
  it.each([
    'messaging/server-unavailable',
    'messaging/internal-error',
    'messaging/message-rate-exceeded',
    'messaging/third-party-auth-error',
    'messaging/mismatched-credential',
    'messaging/something-new',
  ])('retries %s', (code) => {
    expect(isTransientFcmCode(code)).toBe(true);
  });

  it.each([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
    'messaging/payload-size-limit-exceeded',
  ])('does not retry %s', (code) => {
    expect(isTransientFcmCode(code)).toBe(false);
  });
});

describe('FcmProvider', () => {
  let sendEachForMulticast: jest.Mock<
    Promise<BatchResponse>,
    [MulticastMessage]
  >;
  let find: jest.Mock;
  let update: jest.Mock;
  let provider: FcmProvider;

  const withTokens = (...tokens: string[]) =>
    find.mockResolvedValue(tokens.map((token, i) => ({ id: i + 1, token })));

  beforeEach(() => {
    sendEachForMulticast = jest.fn<
      Promise<BatchResponse>,
      [MulticastMessage]
    >();
    find = jest.fn();
    update = jest.fn().mockResolvedValue({ affected: 1 });
    provider = new FcmProvider(
      { sendEachForMulticast } as unknown as Messaging,
      { find, update } as unknown as Repository<DeviceToken>,
    );
  });

  it('sends to every active token with the notification id in data', async () => {
    withTokens('t1', 't2');
    sendEachForMulticast.mockResolvedValue(batch([ok('m1'), ok('m2')]));

    await expect(provider.send(push)).resolves.toEqual({
      providerMessageId: 'm1',
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7, active: true } }),
    );
    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['t1', 't2'],
      notification: { title: 'Kim', body: 'Kim: hello' },
      data: { screen: 'chat', notificationId: '42' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('fails permanently without calling FCM when the user has no token', async () => {
    withTokens();

    await expect(provider.send(push)).rejects.toMatchObject({
      code: 'NO_ACTIVE_DEVICE',
      transient: false,
    });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('succeeds when one token got it and deactivates the dead one', async () => {
    withTokens('alive', 'gone');
    sendEachForMulticast.mockResolvedValue(
      batch([ok('m1'), fail('messaging/registration-token-not-registered')]),
    );

    await expect(provider.send(push)).resolves.toEqual({
      providerMessageId: 'm1',
    });
    expect(update).toHaveBeenCalledTimes(1);
    const [criteria, values] = update.mock.calls[0] as [
      { token: { value: string[] }; active: boolean },
      object,
    ];
    expect(criteria.token.value).toEqual(['gone']);
    expect(criteria.active).toBe(true);
    expect(values).toEqual({
      active: false,
      deactivationReason: 'registration-token-not-registered',
    });
  });

  it('deactivates a token rejected as invalid-argument only if another accepted the payload', async () => {
    withTokens('good', 'malformed');
    sendEachForMulticast.mockResolvedValue(
      batch([ok('m1'), fail('messaging/invalid-argument')]),
    );
    await provider.send(push);
    expect(update).toHaveBeenCalledTimes(1);

    update.mockClear();
    withTokens('malformed');
    sendEachForMulticast.mockResolvedValue(
      batch([fail('messaging/invalid-argument')]),
    );
    await expect(provider.send(push)).rejects.toMatchObject({
      code: 'messaging/invalid-argument',
      transient: false,
    });
    // Could be our payload, so the token is kept.
    expect(update).not.toHaveBeenCalled();
  });

  it('fails permanently when every token is gone', async () => {
    withTokens('a', 'b');
    sendEachForMulticast.mockResolvedValue(
      batch([
        fail('messaging/registration-token-not-registered'),
        fail('messaging/invalid-registration-token'),
      ]),
    );

    await expect(provider.send(push)).rejects.toMatchObject({
      code: 'messaging/registration-token-not-registered',
      transient: false,
    });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('retries when no token got it and one failure is transient', async () => {
    withTokens('gone', 'busy');
    sendEachForMulticast.mockResolvedValue(
      batch([
        fail('messaging/registration-token-not-registered'),
        fail('messaging/server-unavailable'),
      ]),
    );

    await expect(provider.send(push)).rejects.toMatchObject({
      code: 'messaging/server-unavailable',
      transient: true,
    });
  });

  it('classifies an error thrown by the whole call', async () => {
    withTokens('t1');
    sendEachForMulticast.mockRejectedValue(
      Object.assign(new Error('auth'), {
        code: 'messaging/third-party-auth-error',
      }),
    );

    await expect(provider.send(push)).rejects.toMatchObject({
      code: 'messaging/third-party-auth-error',
      transient: true,
    });
  });
});
