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

// Every operation documents what a client needs: a summary, a success
// response, and the credential it takes.
describe('Swagger completeness (e2e)', () => {
  type Operation = {
    tags?: string[];
    summary?: string;
    security?: Record<string, string[]>[];
    responses: Record<string, unknown>;
  };
  let operations: [string, string, Operation][];

  beforeAll(async () => {
    const doc = (await fetchDocument()) as unknown as {
      paths: Record<string, Record<string, Operation>>;
    };
    operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(
        ([method, op]) => [path, method, op] as [string, string, Operation],
      ),
    );
  });

  it('gives each operation a tag, a summary and a 2xx response', () => {
    const missing = operations
      .filter(
        ([, , op]) =>
          !op.tags?.length ||
          !op.summary ||
          !Object.keys(op.responses).some((code) => code.startsWith('2')),
      )
      .map(([path, method]) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it.each([
    ['/admin/', 'admin-key'],
    ['/notification', 'api-key'],
    ['/me/', 'user-jwt'],
    ['/devices', 'user-jwt'],
  ])('documents the credential for %s', (prefix, scheme) => {
    const wrong = operations
      .filter(([path]) => path.startsWith(prefix))
      .filter(([, , op]) => !op.security?.some((s) => Object.hasOwn(s, scheme)))
      .map(([path, method]) => `${method.toUpperCase()} ${path}`);
    expect(wrong).toEqual([]);
  });
});
