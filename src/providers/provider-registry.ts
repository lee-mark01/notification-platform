import { Injectable } from '@nestjs/common';
import { TemplateChannel } from '../templates/template.entity';
import { FakeProvider } from './fake/fake.provider';
import type { NotificationProvider } from './notification-provider';

// Picks the provider for a channel. SES (#31) and FCM (#32) are added here,
// selected by EMAIL_PROVIDER and PUSH_PROVIDER.
@Injectable()
export class ProviderRegistry {
  constructor(private readonly fake: FakeProvider) {}

  forChannel(channel: TemplateChannel): NotificationProvider {
    switch (channel) {
      case TemplateChannel.Email:
      case TemplateChannel.Push:
        return this.fake;
    }
  }
}
