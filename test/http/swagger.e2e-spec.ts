import request from 'supertest';
import { createTestApp } from '../support/app';

describe('Swagger (e2e)', () => {
  it('serves the OpenAPI document with problem schemas when enabled', async () => {
    const app = await createTestApp({ env: { SWAGGER_ENABLED: 'true' } });
    try {
      const res = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);

      const doc = res.body as {
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      expect(Object.keys(doc.components.schemas)).toEqual(
        expect.arrayContaining(['ProblemDetailsDto', 'FieldErrorDto']),
      );
      expect(Object.keys(doc.paths)).toEqual(
        expect.arrayContaining([
          '/health/live',
          '/health/ready',
          '/admin/templates',
          '/admin/templates/{id}',
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('does not expose docs when disabled', async () => {
    const app = await createTestApp({ env: { SWAGGER_ENABLED: 'false' } });
    try {
      await request(app.getHttpServer()).get('/docs-json').expect(404);
      await request(app.getHttpServer()).get('/docs').expect(404);
    } finally {
      await app.close();
    }
  });
});
