import { join } from 'node:path';
import type { MysqlDataSourceOptions } from 'typeorm/driver/mysql/MysqlDataSourceOptions';
import type { EnvironmentVariables } from '../config/env.validation';

export const MIGRATIONS_GLOB = join(__dirname, 'migrations', '*.{ts,js}');
export const ENTITIES_GLOB = join(__dirname, '..', '**', '*.entity.{ts,js}');

type DatabaseEnv = Pick<
  EnvironmentVariables,
  'DB_HOST' | 'DB_PORT' | 'DB_DATABASE' | 'DB_USERNAME' | 'DB_PASSWORD'
>;

// Shared by the Nest app and the migration CLI so the two never drift apart.
export function buildDataSourceOptions(
  env: DatabaseEnv,
): MysqlDataSourceOptions {
  return {
    type: 'mysql',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_DATABASE,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    // Schema changes go through migrations only.
    synchronize: false,
    // Migrations run as a separate deploy step, not on every app boot, so
    // multiple instances starting together do not race on the same migration.
    migrationsRun: false,
    migrations: [MIGRATIONS_GLOB],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
  };
}
