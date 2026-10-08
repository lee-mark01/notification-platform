import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  // Do not advertise the server framework in every response.
  app.disable('x-powered-by');
  // ETags mean one thing here: the version for If-Match on templates. Express
  // would otherwise add weak body-hash ETags to every GET response.
  app.set('etag', false);

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());

  const config = app.get(ConfigService<EnvironmentVariables, true>);
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
        'Unified email and push notification API. Errors use RFC 9457 ' +
          'Problem Details (application/problem+json).',
      )
      .setVersion('0.1.0')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
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
