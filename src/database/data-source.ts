import { existsSync } from 'node:fs';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { validate } from '../config/env.validation';
import { buildDataSourceOptions, ENTITIES_GLOB } from './database.options';

// Entry point for the TypeORM CLI, which runs outside Nest and its
// ConfigModule. In containers the variables come from the environment.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const env = validate(process.env);

export default new DataSource({
  ...buildDataSourceOptions(env),
  entities: [ENTITIES_GLOB],
});
