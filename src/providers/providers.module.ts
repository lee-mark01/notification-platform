import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailProviderKind,
  type EnvironmentVariables,
} from '../config/env.validation';
import { FakeProvider } from './fake/fake.provider';
import type { NotificationProvider } from './notification-provider';
import {
  EMAIL_PROVIDER,
  PUSH_PROVIDER,
  ProviderRegistry,
} from './provider-registry';
import { SesProvider } from './ses/ses.provider';

@Module({
  providers: [
    FakeProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, FakeProvider],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        fake: FakeProvider,
      ): NotificationProvider => {
        if (
          config.get('EMAIL_PROVIDER', { infer: true }) !==
          EmailProviderKind.Ses
        ) {
          return fake;
        }
        const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
        const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', {
          infer: true,
        });
        return new SesProvider({
          // Present: validation requires them when EMAIL_PROVIDER is ses.
          region: config.get('AWS_REGION', { infer: true }),
          fromAddress: config.get('SES_FROM_ADDRESS', { infer: true }),
          credentials:
            accessKeyId && secretAccessKey
              ? { accessKeyId, secretAccessKey }
              : undefined,
        });
      },
    },
    { provide: PUSH_PROVIDER, useExisting: FakeProvider },
    ProviderRegistry,
  ],
  exports: [ProviderRegistry, FakeProvider],
})
export class ProvidersModule {}
