import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketingConsentController } from './marketing-consent.controller';
import { MarketingConsentService } from './marketing-consent.service';

// End-user APIs under /me, authenticated with a user JWT.
@Module({
  imports: [AuthModule],
  controllers: [MarketingConsentController],
  providers: [MarketingConsentService],
})
export class MeModule {}
