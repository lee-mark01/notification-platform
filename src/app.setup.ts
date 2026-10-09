import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { mountBullBoard } from './admin/queues/bull-board';
import { ProblemDetailsFilter } from './common/problem/problem-details.filter';
import {
  FieldErrorDto,
  ProblemDetailsDto,
} from './common/problem/problem-details.dto';
import { createValidationPipe } from './common/validation/validation.pipe';
import type { EnvironmentVariables } from './config/env.validation';

// Global wiring shared by main.ts and E2E tests. Tests build the app without
// main.ts, so anything registered only there would be missing under test.
export function configureApp(app: NestExpressApplication): void {
  // Nest's own Logger calls go through pino from here on.
  app.useLogger(app.get(Logger));
  // Do not advertise the server framework in every response.
  app.disable('x-powered-by');
  // ETags mean one thing here: the version for If-Match on templates. Express
  // would otherwise add weak body-hash ETags to every GET response.
  app.set('etag', false);

  // POST /notification-batches takes up to 10,000 recipients; Express's
  // default JSON limit is 100kb.
  app.useBodyParser('json', { limit: '5mb' });
  // SNS posts its JSON with Content-Type text/plain (POST /webhooks/ses).
  app.useBodyParser('text', { type: 'text/plain', limit: '256kb' });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());

  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const origins = parseOrigins(config.get('CORS_ORIGINS', { infer: true }));
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      // Browsers hide response headers from scripts unless listed here; the
      // API returns the created resource in Location, versions in ETag and
      // the correlation id in X-Request-Id.
      exposedHeaders: ['ETag', 'Location', 'X-Request-Id'],
    });
  }

  mountBullBoard(app);

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    setupSwagger(app);
  }
}

function setupSwagger(app: NestExpressApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('notification-platform')
      .setDescription(
        [
          'Unified email and push notification API.',
          '',
          '- Errors use RFC 9457 Problem Details (application/problem+json).',
          '- POST requests that create notifications need an Idempotency-Key header.',
          '- Every response carries X-Request-Id; send your own to trace a request into the worker logs.',
          '- Credentials: X-API-Key for sending services, Bearer JWT for end users, X-Admin-Key for operators.',
        ].join('\n'),
      )
      .setVersion('0.1.0')
      // Listed in this order in the UI: sending first, operations last.
      .addTag(
        'notifications',
        'Send one notification or a batch, and read its status',
      )
      .addTag('devices', 'Register FCM tokens for web push (end user)')
      .addTag('me', 'Inbox, read state and marketing consent (end user)')
      .addTag('webhooks', 'SES events through SNS, signature-checked')
      .addTag(
        'admin: templates',
        'Templates with optimistic locking and preview',
      )
      .addTag('admin: notifications', 'Delivery history search')
      .addTag('admin: dlq', 'Dead notifications and redrive')
      .addTag('admin: suppressions', 'Blocked addresses')
      .addTag('admin: stats', 'Delivery and read rates')
      .addTag('admin: queues', 'Job counts per queue')
      .addTag('health', 'Liveness and readiness probes')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
      .addApiKey(
        { type: 'apiKey', in: 'header', name: 'X-Admin-Key' },
        'admin-key',
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'user-jwt',
      )
      .build(),
    { extraModels: [ProblemDetailsDto, FieldErrorDto] },
  );
  // UI at /docs, OpenAPI JSON at /docs-json.
  SwaggerModule.setup('docs', app, document);
}

export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
