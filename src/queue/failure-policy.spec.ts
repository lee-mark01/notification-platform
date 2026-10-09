import { ProviderError } from '../providers/notification-provider';
import { classifyError, decideFailure, FailureAction } from './failure-policy';

describe('classifyError', () => {
  it('keeps the classification of a provider error', () => {
    expect(
      classifyError(new ProviderError('MessageRejected', false, 'rejected')),
    ).toEqual({
      code: 'MessageRejected',
      transient: false,
      message: 'rejected',
      invalidRecipient: false,
    });
  });

  it('treats an unclassified error as transient', () => {
    expect(classifyError(new TypeError('boom'))).toEqual({
      code: 'UNCLASSIFIED',
      transient: true,
      message: 'boom',
      invalidRecipient: false,
    });
    expect(classifyError('text')).toMatchObject({ transient: true });
  });
});

describe('decideFailure (5 attempts)', () => {
  it.each([
    [true, 0, FailureAction.Retry],
    [true, 3, FailureAction.Retry],
    [true, 4, FailureAction.Dead],
    [false, 0, FailureAction.Fail],
    [false, 4, FailureAction.Fail],
  ])(
    'transient=%s after %i finished attempts -> %s',
    (transient, attemptsMade, action) => {
      expect(decideFailure({ transient }, attemptsMade, 5)).toBe(action);
    },
  );

  it('goes straight to DEAD when only one attempt is allowed', () => {
    expect(decideFailure({ transient: true }, 0, 1)).toBe(FailureAction.Dead);
  });
});
