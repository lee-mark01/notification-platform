import { DataSource } from 'typeorm';
import { ProbeTable9999999999999 } from '../fixtures/migrations/probe-table.migration';
import { MIGRATION_TEST_DATABASE } from '../setup/global-setup';
import { createTestDataSource, loadMigrations } from '../support/database';

async function tableNames(dataSource: DataSource): Promise<string[]> {
  const rows: { name: string }[] = await dataSource.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() ORDER BY table_name`,
  );
  return rows.map((r) => r.name);
}

async function executedMigrationNames(
  dataSource: DataSource,
): Promise<string[]> {
  const rows: { name: string }[] = await dataSource.query(
    'SELECT name FROM migrations ORDER BY id',
  );
  return rows.map((r) => r.name);
}

describe('Database migrations (e2e)', () => {
  describe('schema drift', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
      dataSource = await createTestDataSource().initialize();
      await dataSource.runMigrations();
    });

    afterAll(async () => {
      await dataSource.destroy();
    });

    it('leaves no pending migrations', async () => {
      await expect(dataSource.showMigrations()).resolves.toBe(false);
    });

    // Fails when an entity changes without a matching migration.
    it('matches the entities exactly after all migrations run', async () => {
      const sql = await dataSource.driver.createSchemaBuilder().log();

      expect(sql.upQueries.map((q) => q.query)).toEqual([]);
    });
  });

  describe('run and revert', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
      dataSource = await createTestDataSource({
        database: MIGRATION_TEST_DATABASE,
        migrations: [...loadMigrations(), ProbeTable9999999999999],
      }).initialize();
    });

    afterAll(async () => {
      await dataSource.destroy();
    });

    it('applies a migration and records it', async () => {
      await dataSource.runMigrations();

      expect(await tableNames(dataSource)).toContain('e2e_probe');
      expect(await executedMigrationNames(dataSource)).toContain(
        'ProbeTable9999999999999',
      );
    });

    it('reverts the latest migration and removes its record', async () => {
      await dataSource.undoLastMigration();

      expect(await tableNames(dataSource)).not.toContain('e2e_probe');
      expect(await executedMigrationNames(dataSource)).not.toContain(
        'ProbeTable9999999999999',
      );
    });

    // Every down() must undo its up(), leaving only the history table.
    it('reverts every real migration back to an empty schema', async () => {
      while ((await executedMigrationNames(dataSource)).length > 0) {
        await dataSource.undoLastMigration();
      }

      expect(await tableNames(dataSource)).toEqual(['migrations']);
    });
  });

  // Data, not just schema: existing keys must keep working across the split.
  describe('moving API keys into api_key', () => {
    const SPLIT = 'SplitApiKeys1791578838865';
    const before = loadMigrations().filter((m) => m.name !== SPLIT);
    let dataSource: DataSource;

    beforeAll(async () => {
      const old = await createTestDataSource({
        database: MIGRATION_TEST_DATABASE,
        migrations: before,
      }).initialize();
      await old.runMigrations();
      await old.query(
        `INSERT INTO api_client (name, api_key_hash) VALUES ('a', REPEAT('a', 64)), ('b', REPEAT('b', 64))`,
      );
      await old.destroy();
      dataSource = await createTestDataSource({
        database: MIGRATION_TEST_DATABASE,
      }).initialize();
    });

    afterAll(async () => {
      while ((await executedMigrationNames(dataSource)).length > 0) {
        await dataSource.undoLastMigration();
      }
      await dataSource.destroy();
    });

    it('copies each client key on the way up', async () => {
      await dataSource.runMigrations();

      const rows: { name: string; key_hash: string; revoked_at: unknown }[] =
        await dataSource.query(
          `SELECT c.name, k.key_hash, k.revoked_at FROM api_key k
           JOIN api_client c ON c.id = k.client_id ORDER BY c.name`,
        );
      expect(rows).toEqual([
        { name: 'a', key_hash: 'a'.repeat(64), revoked_at: null },
        { name: 'b', key_hash: 'b'.repeat(64), revoked_at: null },
      ]);
    });

    it('puts back the newest active key on the way down', async () => {
      const [{ id }]: { id: number }[] = await dataSource.query(
        `SELECT id FROM api_client WHERE name = 'a'`,
      );
      await dataSource.query(
        `UPDATE api_key SET revoked_at = NOW(3) WHERE client_id = ?`,
        [id],
      );
      await dataSource.query(
        `INSERT INTO api_key (client_id, key_hash) VALUES (?, REPEAT('c', 64))`,
        [id],
      );

      await dataSource.undoLastMigration();

      const rows: { name: string; api_key_hash: string }[] =
        await dataSource.query(
          'SELECT name, api_key_hash FROM api_client ORDER BY name',
        );
      expect(rows).toEqual([
        { name: 'a', api_key_hash: 'c'.repeat(64) },
        { name: 'b', api_key_hash: 'b'.repeat(64) },
      ]);
    });
  });
});
