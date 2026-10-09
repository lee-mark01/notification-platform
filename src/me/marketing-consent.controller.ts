import { Body, Controller, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, UserJwtGuard } from '../auth/user-jwt.guard';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { AppUser } from '../users/app-user.entity';
import {
  MarketingConsentDto,
  MarketingConsentResponse,
} from './marketing-consent.dto';
import { MarketingConsentService } from './marketing-consent.service';

@ApiTags('me')
@ApiBearerAuth('user-jwt')
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
@Controller('me/marketing-consent')
@UseGuards(UserJwtGuard)
export class MarketingConsentController {
  constructor(private readonly consent: MarketingConsentService) {}

  @Put()
  @ApiOperation({ summary: 'Give or withdraw consent to marketing messages' })
  @ApiOkResponse({ type: MarketingConsentResponse })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  async set(
    @CurrentUser() user: AppUser,
    @Body() dto: MarketingConsentDto,
  ): Promise<MarketingConsentResponse> {
    return this.consent.set(user, dto.optIn);
  }
}
