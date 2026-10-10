import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ApiClient } from '../../src/clients/api-client.entity';
import { generateApiKey, hashApiKey } from '../../src/clients/api-key';
import { ApiKey } from '../../src/clients/api-key.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { seedClient, seedEmailTemplate } from '../support/seed';

// Rotation as the operator does it with npm run client:key: add a key,
// switch the caller, revoke the old one.
describe('API key rotation (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let client: ApiClient;
  let oldKey: string;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    ({ client, apiKey: oldKey } = await seedClient(dataSource));
    await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const addKey = async () => {
    const apiKey = generateApiKey();
    await dataSource
      .getRepository(ApiKey)
      .save({ clientId: client.id, keyHash: hashApiKey(apiKey) });
    return apiKey;
  };

  const send = (apiKey: string) =>
    request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        channel: 'email',
        category: 'transactional',
        templateKey: 'email-verification',
        recipient: { email: 'a@example.com' },
        variables: { code: '1' },
      });

  it('lets both keys work during the switch, as the same client', async () => {
    const res = await send(oldKey).expect(202);
    const id = (res.body as { id: number }).id;
    const newKey = await addKey();

    // The client is the same, so what it sent before is still its own.
    await request(app.getHttpServer())
      .get(`/notifications/${id}`)
      .set('X-API-Key', newKey)
      .expect(200);
    await send(oldKey).expect(202);
    await send(newKey).expect(202);
  });

  it('refuses a revoked key at once and keeps the others', async () => {
    const newKey = await addKey();
    await dataSource
      .getRepository(ApiKey)
      .update({ keyHash: hashApiKey(oldKey) }, { revokedAt: new Date() });

    await send(oldKey)
      .expect(401)
      .expect('WWW-Authenticate', 'ApiKey header="X-API-Key"');
    await send(newKey).expect(202);
  });
});
