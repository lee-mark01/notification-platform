import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { DeviceToken } from '../../src/devices/device-token.entity';
import { AppUser } from '../../src/users/app-user.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { seedUser } from '../support/seed';

const SECRET = process.env.JWT_SECRET as string;

describe('POST /devices (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let alice: AppUser;
  let bob: AppUser;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    alice = await seedUser(dataSource);
    bob = await seedUser(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenFor = (
    user: AppUser,
    options: { secret?: string; expiresIn?: number } = {},
  ) =>
    new JwtService().sign(
      { sub: String(user.id) },
      {
        secret: options.secret ?? SECRET,
        algorithm: 'HS256',
        expiresIn: options.expiresIn ?? 3600,
      },
    );

  const register = (jwt: string | null, body: object) => {
    const req = request(app.getHttpServer()).post('/devices');
    if (jwt !== null) req.set('Authorization', `Bearer ${jwt}`);
    return req.send(body);
  };

  const devices = () =>
    dataSource.getRepository(DeviceToken).find({ order: { id: 'ASC' } });

  describe('registering', () => {
    it('creates a token for the user and returns 201', async () => {
      const res = await register(tokenFor(alice), {
        token: 'fcm-token-1',
        platform: 'web',
      }).expect(201);

      expect(res.body).toEqual({
        id: expect.any(Number) as number,
        platform: 'web',
        active: true,
        lastSeenAt: expect.any(String) as string,
      });
      expect(await devices()).toEqual([
        expect.objectContaining({
          userId: alice.id,
          token: 'fcm-token-1',
          active: true,
        }),
      ]);
    });

    it('returns 200 and keeps one row when the same token is registered again', async () => {
      const first = await register(tokenFor(alice), {
        token: 'fcm-token-1',
        platform: 'web',
      }).expect(201);
      const second = await register(tokenFor(alice), {
        token: 'fcm-token-1',
        platform: 'web',
      }).expect(200);

      expect((second.body as { id: number }).id).toBe(
        (first.body as { id: number }).id,
      );
      expect(await devices()).toHaveLength(1);
    });

    it('moves a token to the user who registers it last', async () => {
      await register(tokenFor(alice), {
        token: 'shared-browser',
        platform: 'web',
      }).expect(201);
      await register(tokenFor(bob), {
        token: 'shared-browser',
        platform: 'web',
      }).expect(200);

      expect(await devices()).toEqual([
        expect.objectContaining({ userId: bob.id, token: 'shared-browser' }),
      ]);
    });

    it('reactivates a token that had been deactivated', async () => {
      await register(tokenFor(alice), {
        token: 'fcm-token-1',
        platform: 'web',
      }).expect(201);
      await dataSource
        .getRepository(DeviceToken)
        .update(
          { token: 'fcm-token-1' },
          { active: false, deactivationReason: 'UNREGISTERED' },
        );

      const res = await register(tokenFor(alice), {
        token: 'fcm-token-1',
        platform: 'web',
      }).expect(200);

      expect((res.body as { active: boolean }).active).toBe(true);
      expect(await devices()).toEqual([
        expect.objectContaining({ active: true, deactivationReason: null }),
      ]);
    });

    it('keeps one row when the same token is registered concurrently', async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          register(tokenFor(alice), { token: 'race', platform: 'web' }),
        ),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([
        200, 200, 200, 200, 201,
      ]);
      expect(await devices()).toHaveLength(1);
    });

    it('rejects an invalid body with 400', async () => {
      await register(tokenFor(alice), { token: '', platform: 'ios' }).expect(
        400,
      );
      expect(await devices()).toHaveLength(0);
    });
  });

  describe('authentication', () => {
    const body = { token: 'fcm-token-1', platform: 'web' };

    const expect401 = async (jwt: string | null) => {
      const res = await register(jwt, body).expect(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(await devices()).toHaveLength(0);
    };

    it('rejects a missing token', () => expect401(null));

    it('rejects a token signed with another secret', () =>
      expect401(
        tokenFor(alice, { secret: 'another-secret-that-is-32-chars!!' }),
      ));

    it('rejects an expired token', () =>
      expect401(tokenFor(alice, { expiresIn: -10 })));

    it('rejects a token without an expiry', () =>
      expect401(
        new JwtService().sign(
          { sub: String(alice.id) },
          { secret: SECRET, algorithm: 'HS256' },
        ),
      ));

    it('rejects an unsigned token (alg none)', () => {
      const encode = (part: object) =>
        Buffer.from(JSON.stringify(part)).toString('base64url');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return expect401(
        `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: String(alice.id), exp })}.`,
      );
    });

    it('rejects a token for a user that does not exist', () =>
      expect401(tokenFor({ id: 999_999 } as AppUser)));

    it('rejects a subject that is not a user id', () =>
      expect401(
        new JwtService().sign(
          { sub: 'alice' },
          { secret: SECRET, algorithm: 'HS256', expiresIn: 3600 },
        ),
      ));
  });
});
