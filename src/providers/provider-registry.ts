import { Inject, Injectable } from '@nestjs/common';
import { TemplateChannel } from '../templates/template.entity';
import type { NotificationProvider } from './notification-provider';

// Chosen once at startup from EMAIL_PROVIDER and PUSH_PROVIDER.
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

@Injectable()
export class ProviderRegistry {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly email: NotificationProvider,
    @Inject(PUSH_PROVIDER) private readonly push: NotificationProvider,
  ) {}

  forChannel(channel: TemplateChannel): NotificationProvider {
    return channel === TemplateChannel.Email ? this.email : this.push;
  }
}
