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
});
