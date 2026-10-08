import request from 'supertest';
import { createTestApp } from '../support/app';

interface OpenApiDoc {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content?: Record<string, { example?: Record<string, unknown> }> }
        >;
      }
    >
  >;
  components: { schemas: Record<string, unknown> };
}

async function fetchDocument(): Promise<OpenApiDoc> {
  const app = await createTestApp({ env: { SWAGGER_ENABLED: 'true' } });
  try {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    return res.body as OpenApiDoc;
  } finally {
    await app.close();
  }
}

describe('Swagger (e2e)', () => {
  let doc: OpenApiDoc;

  beforeAll(async () => {
    doc = await fetchDocument();
  });

  it('serves the OpenAPI document with problem schemas when enabled', () => {
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
    expect(doc.paths).not.toHaveProperty('/');
  });

  describe('error response examples', () => {
    const exampleOf = (path: string, method: string, status: string) =>
      doc.paths[path][method].responses[status].content?.[
        'application/problem+json'
      ]?.example;

    it.each([
      ['/admin/templates/{id}', 'get', '404', '/problems/resource-not-found'],
      [
        '/admin/templates/{id}',
        'patch',
        '412',
        '/problems/precondition-failed',
      ],
      [
        '/admin/templates/{id}',
        'patch',
        '428',
        '/problems/precondition-required',
      ],
      ['/admin/templates', 'post', '409', '/problems/template-key-conflict'],
      ['/admin/templates', 'post', '400', '/problems/validation-failed'],
    ])('%s %s %s shows its own problem type', (path, method, status, type) => {
      expect(exampleOf(path, method, status)).toMatchObject({
        type,
        status: Number(status),
      });
    });

    it('includes field errors only for validation-failed', () => {
      expect(exampleOf('/admin/templates', 'post', '400')).toHaveProperty(
        'errors',
      );
      expect(
        exampleOf('/admin/templates/{id}', 'get', '404'),
      ).not.toHaveProperty('errors');
    });
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
