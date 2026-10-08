import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type * as AppSupport from '../support/app';

// ConfigModule reads SWAGGER_ENABLED when AppModule is first loaded, so each
// case loads the app modules in isolation after setting the variable.
async function appWithSwagger(
  enabled: boolean,
): Promise<INestApplication<App>> {
  const previous = process.env.SWAGGER_ENABLED;
  process.env.SWAGGER_ENABLED = String(enabled);
  try {
    let app: INestApplication<App> | undefined;
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolated load
      const { createTestApp } = require('../support/app') as typeof AppSupport;
      app = await createTestApp();
    });
    return app!;
  } finally {
    process.env.SWAGGER_ENABLED = previous;
  }
}

describe('Swagger (e2e)', () => {
  it('serves the OpenAPI document with problem schemas when enabled', async () => {
    const app = await appWithSwagger(true);
    try {
      const res = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);

      const schemas = (
        res.body as { components: { schemas: Record<string, unknown> } }
      ).components.schemas;
      expect(Object.keys(schemas)).toEqual(
        expect.arrayContaining(['ProblemDetailsDto', 'FieldErrorDto']),
      );
    } finally {
      await app.close();
    }
  });

  it('does not expose docs when disabled', async () => {
    const app = await appWithSwagger(false);
    try {
      await request(app.getHttpServer()).get('/docs-json').expect(404);
      await request(app.getHttpServer()).get('/docs').expect(404);
    } finally {
      await app.close();
    }
  });
});
