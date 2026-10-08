import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation';
import { buildDataSourceOptions } from '../../src/database/database.options';

type ClassConstructor = new (...args: never[]) => unknown;

const SRC_DIR = join(__dirname, '..', '..', 'src');
const MIGRATIONS_DIR = join(SRC_DIR, 'database', 'migrations');

// TypeORM loads glob paths with Node's own loader, which cannot run the
// decorators in .ts entity files under Jest. Requiring the files here goes
// through Jest's transformer instead, then the classes are passed directly.
function requireClasses(files: string[]): ClassConstructor[] {
  return files.flatMap((file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    const exported = require(file) as Record<string, unknown>;
    return Object.values(exported).filter(
      (value): value is ClassConstructor => typeof value === 'function',
    );
  });
}

function listFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => pattern.test(file))
    .sort()
    .map((file) => join(dir, file));
}

export function loadMigrations(dir = MIGRATIONS_DIR): ClassConstructor[] {
  return requireClasses(listFiles(dir, /\.ts$/));
}

export function loadEntities(): ClassConstructor[] {
  return requireClasses(listFiles(SRC_DIR, /\.entity\.ts$/));
}

export function createTestDataSource(
  overrides: { database?: string; migrations?: ClassConstructor[] } = {},
): DataSource {
  const env = validate(process.env);
  return new DataSource({
    ...buildDataSourceOptions({
      ...env,
      DB_DATABASE: overrides.database ?? env.DB_DATABASE,
    }),
    entities: loadEntities(),
    migrations: overrides.migrations ?? loadMigrations(),
  });
}

// Empties every table except the migration history so each test starts from
// the same schema with no rows. Foreign key checks are paused only for the
// duration of the truncation.
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  const migrationsTable =
    dataSource.options.migrationsTableName ?? 'migrations';
  const rows: { name: string }[] = await dataSource.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
  );
  const tables = rows.map((r) => r.name).filter((n) => n !== migrationsTable);
  if (tables.length === 0) return;

  const runner = dataSource.createQueryRunner();
  try {
    await runner.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await runner.query(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    await runner.query('SET FOREIGN_KEY_CHECKS = 1');
    await runner.release();
  }
}
