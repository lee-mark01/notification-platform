import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { Repository } from 'typeorm';
import {
  EmailProviderKind,
  type EnvironmentVariables,
  PushProviderKind,
} from '../config/env.validation';
import { DeviceToken } from '../devices/device-token.entity';
import { FakeProvider } from './fake/fake.provider';
import { FcmProvider } from './fcm/fcm.provider';
import type { NotificationProvider } from './notification-provider';
import {
  EMAIL_PROVIDER,
  PUSH_PROVIDER,
  ProviderRegistry,
} from './provider-registry';
import { SesProvider } from './ses/ses.provider';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken])],
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
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService, FakeProvider, getRepositoryToken(DeviceToken)],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        fake: FakeProvider,
        devices: Repository<DeviceToken>,
      ): NotificationProvider => {
        if (
          config.get('PUSH_PROVIDER', { infer: true }) !== PushProviderKind.Fcm
        ) {
          return fake;
        }
        // A named app, so nothing else in the process can replace it.
        const app = initializeApp(
          {
            credential: cert(
              config.get('GOOGLE_APPLICATION_CREDENTIALS', { infer: true }),
            ),
            projectId: config.get('FIREBASE_PROJECT_ID', { infer: true }),
          },
          'notification-platform',
        );
        return new FcmProvider(getMessaging(app), devices);
      },
    },
    ProviderRegistry,
  ],
  exports: [ProviderRegistry, FakeProvider],
})
export class ProvidersModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(getApps().map((app) => deleteApp(app)));
  }
}
