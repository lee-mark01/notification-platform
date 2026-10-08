import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProblemProbeController } from '../fixtures/problem-probe.controller';
import { createTestApp } from '../support/app';

const PROBLEM_JSON = /^application\/problem\+json/;

describe('Error responses (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProblemProbeController] });
  });

  afterAll(async () => {
    await app.close();
  });

  const validBody = {
    channel: 'email',
    recipient: { email: 'user@example.com' },
    templateKey: 'welcome',
  };

  it('passes a valid body through as a DTO instance', async () => {
    await request(app.getHttpServer())
      .post('/__probe/validate')
      .send(validBody)
      .expect(200, { ok: true, isDto: true });
  });

  it('returns validation-failed with field paths, including nested ones', async () => {
    const res = await request(app.getHttpServer())
      .post('/__probe/validate')
      .send({ channel: 'sms', recipient: { email: 'nope' } })
      .expect(400)
      .expect('Content-Type', PROBLEM_JSON);

    expect(res.body).toMatchObject({
      type: '/problems/validation-failed',
      title: 'Request validation failed',
      status: 400,
      instance: '/__probe/validate',
    });
    const fields = (res.body as { errors: { field: string }[] }).errors.map(
      (e) => e.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining(['channel', 'recipient.email', 'templateKey']),
    );
  });

  it('rejects properties the DTO does not declare', async () => {
    const res = await request(app.getHttpServer())
      .post('/__probe/validate')
      .send({ ...validBody, priority: 'high' })
      .expect(400);

    expect(res.body).toMatchObject({
      type: '/problems/validation-failed',
      errors: [
        { field: 'priority', message: 'property priority should not exist' },
      ],
    });
  });

  it('returns about:blank 400 for malformed JSON', async () => {
    const res = await request(app.getHttpServer())
      .post('/__probe/validate')
      .set('Content-Type', 'application/json')
      .send('{"channel":')
      .expect(400)
      .expect('Content-Type', PROBLEM_JSON);

    expect(res.body).toMatchObject({ type: 'about:blank', status: 400 });
  });

  it('returns about:blank 404 for unknown routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/does-not-exist?token=secret')
      .expect(404)
      .expect('Content-Type', PROBLEM_JSON);

    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Cannot GET /does-not-exist?token=secret',
      instance: '/does-not-exist',
    });
  });

  it('returns a generic internal-error without leaking the message', async () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const res = await request(app.getHttpServer())
      .get('/__probe/crash')
      .expect(500)
      .expect('Content-Type', PROBLEM_JSON);

    expect(res.body).toEqual({
      type: '/problems/internal-error',
      title: 'Internal server error',
      status: 500,
      instance: '/__probe/crash',
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });

  it.each([
    [
      'IDEMPOTENCY_KEY_IN_PROGRESS',
      409,
      '/problems/idempotency-key-in-progress',
    ],
    ['IDEMPOTENCY_KEY_REUSED', 422, '/problems/idempotency-key-reused'],
  ])('returns %s as %i with its type', async (name, status, type) => {
    const res = await request(app.getHttpServer())
      .get(`/__probe/problem/${name}`)
      .expect(status)
      .expect('Content-Type', PROBLEM_JSON);

    expect(res.body).toMatchObject({ type, status });
  });
});
