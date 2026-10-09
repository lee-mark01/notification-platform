import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppUser } from '../../src/users/app-user.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { seedUser } from '../support/seed';

describe('PUT /me/marketing-consent (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let user: AppUser;
  let token: string;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    user = await seedUser(dataSource);
    token = new JwtService().sign(
      { sub: String(user.id) },
      {
        secret: process.env.JWT_SECRET as string,
        algorithm: 'HS256',
        expiresIn: 3600,
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const put = (body: object, jwt: string | null = token) => {
    const req = request(app.getHttpServer()).put('/me/marketing-consent');
    if (jwt) req.set('Authorization', `Bearer ${jwt}`);
    return req.send(body);
  };

  const stored = () =>
    dataSource.getRepository(AppUser).findOneByOrFail({ id: user.id });

  it('records consent and when it was given', async () => {
    const res = await put({ optIn: true }).expect(200);

    expect(res.body).toEqual({
      optIn: true,
      updatedAt: expect.any(String) as string,
    });
    const row = await stored();
    expect(row.marketingOptIn).toBe(true);
    expect(row.marketingOptInAt).toBeInstanceOf(Date);
  });

  it('is idempotent: repeating keeps the original consent time', async () => {
    await put({ optIn: true }).expect(200);
    const before = await stored();

    const again = await put({ optIn: true }).expect(200);

    const after = await stored();
    expect(after.marketingOptInAt).toEqual(before.marketingOptInAt);
    expect((again.body as { updatedAt: string }).updatedAt).toBe(
      before.updatedAt.toISOString(),
    );
  });

  it('withdraws consent and clears the consent time', async () => {
    await put({ optIn: true }).expect(200);

    await put({ optIn: false }).expect(200);

    const row = await stored();
    expect(row.marketingOptIn).toBe(false);
    expect(row.marketingOptInAt).toBeNull();
  });

  it('rejects a body without a boolean', async () => {
    await put({ optIn: 'yes' }).expect(400);
  });

  it('requires a user token', async () => {
    await put({ optIn: true }, null).expect(401);
  });
});
