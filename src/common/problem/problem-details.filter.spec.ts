import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProblemDetailsFilter } from './problem-details.filter';
import { ProblemTypes } from './problem-types';
import { ProblemException } from './problem.exception';

function createHost(originalUrl = '/notifications?token=secret') {
  const response = {
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const request = { method: 'POST', originalUrl };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes a ProblemException with its type, detail, and extensions', () => {
    const { host, response } = createHost();
    const errors = [{ field: 'email', message: 'email must be an email' }];

    filter.catch(
      new ProblemException(ProblemTypes.VALIDATION_FAILED, 'Invalid body', {
        errors,
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.json).toHaveBeenCalledWith({
      type: '/problems/validation-failed',
      title: 'Request validation failed',
      status: 400,
      detail: 'Invalid body',
      instance: '/notifications',
      errors,
    });
  });

  it('distinguishes 409 and 422 idempotency problems by type', () => {
    const inProgress = createHost();
    const reused = createHost();

    filter.catch(
      new ProblemException(ProblemTypes.IDEMPOTENCY_KEY_IN_PROGRESS),
      inProgress.host,
    );
    filter.catch(
      new ProblemException(ProblemTypes.IDEMPOTENCY_KEY_REUSED),
      reused.host,
    );

    expect(inProgress.response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '/problems/idempotency-key-in-progress',
        status: 409,
      }),
    );
    expect(reused.response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '/problems/idempotency-key-reused',
        status: 422,
      }),
    );
  });

  it('sends the headers a ProblemException carries', () => {
    const { host, response } = createHost();

    filter.catch(
      new ProblemException(
        ProblemTypes.IDEMPOTENCY_KEY_IN_PROGRESS,
        undefined,
        {},
        { 'Retry-After': '3' },
      ),
      host,
    );

    expect(response.set).toHaveBeenCalledWith({ 'Retry-After': '3' });
  });

  it('maps Nest HttpExceptions to about:blank with the status reason', () => {
    const { host, response } = createHost('/missing');

    filter.catch(new NotFoundException('Cannot GET /missing'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Cannot GET /missing',
      instance: '/missing',
    });
  });

  it('joins message arrays from HttpException bodies into detail', () => {
    const { host, response } = createHost();

    filter.catch(new BadRequestException(['a is bad', 'b is bad']), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'a is bad; b is bad' }),
    );
  });

  it('hides the message of 5xx HttpExceptions', () => {
    const { host, response } = createHost();

    filter.catch(new ServiceUnavailableException('db pool exhausted'), host);

    const [body] = response.json.mock.calls[0] as [Record<string, unknown>];
    expect(body).not.toHaveProperty('detail');
  });

  it('returns a generic 500 for unknown errors and logs the stack', () => {
    const { host, response } = createHost();

    filter.catch(new Error('password=hunter2 in connection string'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      type: '/problems/internal-error',
      title: 'Internal server error',
      status: 500,
      instance: '/notifications',
    });
    expect(logError).toHaveBeenCalledWith(
      'POST /notifications -> 500',
      expect.stringContaining('password=hunter2'),
    );
  });
});
