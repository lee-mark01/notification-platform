import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());

  const config = app.get(ConfigService<EnvironmentVariables, true>);
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    setupSwagger(app);
  }
}

function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('notification-platform')
      .setDescription(
        'Unified email and push notification API. Errors use RFC 9457 ' +
          'Problem Details (application/problem+json).',
      )
      .setVersion('0.1.0')
      .build(),
    { extraModels: [ProblemDetailsDto, FieldErrorDto] },
  );
  // UI at /docs, OpenAPI JSON at /docs-json.
  SwaggerModule.setup('docs', app, document);
}
