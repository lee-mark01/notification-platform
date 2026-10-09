import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import type { NextFunction, Request, Response } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation';
import { QueueNames } from '../../queue/queue.constants';
import { ADMIN_KEY_HEADER, adminKeyMatcher } from '../admin-key.guard';

export const BULL_BOARD_PATH = '/admin/queues/board';

/**
 * Bull Board at /admin/queues/board, read-only. Fixing jobs by hand in Redis
 * would bypass the database, which is the source of truth (redrive goes
 * through POST /admin/dlq/redrive). A browser cannot send X-Admin-Key, so the
 * page also accepts HTTP Basic with the admin key as the password.
 */
export function mountBullBoard(app: NestExpressApplication): void {
  const serverAdapter = new ExpressAdapter().setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: Object.values(QueueNames).map(
      (name) =>
        new BullMQAdapter(app.get<Queue>(getQueueToken(name)), {
          readOnlyMode: true,
        }),
    ),
    serverAdapter,
    options: { uiConfig: { boardTitle: 'notification-platform' } },
  });

  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const matches = adminKeyMatcher(config.get('ADMIN_API_KEY', { infer: true }));
  app.use(
    BULL_BOARD_PATH,
    (req: Request, res: Response, next: NextFunction) => {
      if (
        matches(req.header(ADMIN_KEY_HEADER)) ||
        matches(basicPassword(req))
      ) {
        next();
        return;
      }
      res
        .status(401)
        .setHeader('WWW-Authenticate', 'Basic realm="admin", charset="UTF-8"')
        .end();
    },
    serverAdapter.getRouter() as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void,
  );
}

function basicPassword(req: Request): string | undefined {
  const header = req.header('authorization');
  if (!header?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? undefined : decoded.slice(colon + 1);
}
