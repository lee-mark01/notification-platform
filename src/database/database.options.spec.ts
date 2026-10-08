import { buildDataSourceOptions } from './database.options';

describe('buildDataSourceOptions', () => {
  const options = buildDataSourceOptions({
    DB_HOST: 'db',
    DB_PORT: 3306,
    DB_DATABASE: 'notification',
    DB_USERNAME: 'app',
    DB_PASSWORD: 'secret',
  });

  it('never synchronizes the schema from entities', () => {
    expect(options.synchronize).toBe(false);
  });

  it('does not run migrations on application boot', () => {
    expect(options.migrationsRun).toBe(false);
  });

  it('returns BIGINT values without losing precision', () => {
    expect(options.supportBigNumbers).toBe(true);
    expect(options.bigNumberStrings).toBe(false);
  });

  it('uses utf8mb4 and UTC', () => {
    expect(options.charset).toBe('utf8mb4');
    expect(options.timezone).toBe('Z');
  });
});
