import type { ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { validate } from '../../src/config/env.validation';

export interface TestAppOptions extends Pick<
  ModuleMetadata,
  'imports' | 'controllers'
> {
  /**
   * Settings for this app only, layered over process.env and validated the
   * same way as at startup. ConfigService is replaced rather than process.env
   * changed, because ConfigModule reads process.env once per module load.
   */
  env?: Record<string, string>;
  /** Providers replaced by a factory, e.g. a provider adapter over a fake. */
  overrides?: {
    provide: unknown;
    factory: (...args: never[]) => unknown;
    inject?: unknown[];
  }[];
}

// Builds the real AppModule with the same global wiring as main.ts.
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
    controllers: options.controllers ?? [],
  });

  if (options.env) {
    const config = { ...validate({ ...process.env, ...options.env }) };
    builder = builder
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config));
  }

  for (const { provide, factory, inject } of options.overrides ?? []) {
    builder = builder
      .overrideProvider(provide)
      .useFactory({ factory, inject: inject as never[] });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
