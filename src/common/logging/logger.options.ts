import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { Environment } from '../../config/env.validation';

export const REQUEST_ID_HEADER = 'x-request-id';

// A caller's id is kept only if it is short and harmless in a log line or a
// header; anything else is replaced, so clients cannot inject log content.
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdFor(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const given = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof given === 'string' && VALID_REQUEST_ID.test(given)
      ? given
      : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/** The request id pino-http assigned, to pass on with the work. */
export function correlationIdOf(req: IncomingMessage): string | undefined {
  return typeof req.id === 'string' ? req.id : undefined;
}

/**
 * JSON logs through pino, one line per request with its id. The request id is
 * the correlation id: it goes into the job data and the worker logs under it.
 * Past that point (sweeper re-adds, SES webhooks) the notification id ties
 * the lines together.
 */
export function loggerParams(options: {
  level: string;
  nodeEnv: Environment;
}): Params {
  return {
    pinoHttp: {
      level: options.level,
      genReqId: requestIdFor,
      // Keys and tokens must never reach a log line.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers["x-admin-key"]',
          'req.headers.cookie',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // Probes every few seconds would bury the requests that matter.
      autoLogging: {
        ignore: (req: IncomingMessage) =>
          req.url?.startsWith('/health') ?? false,
      },
      transport:
        options.nodeEnv === Environment.Development
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
    },
  };
}
