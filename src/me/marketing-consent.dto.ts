import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class MarketingConsentDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  optIn: boolean;
}

export class MarketingConsentResponse {
  @ApiProperty({ example: false })
  optIn: boolean;

  @ApiProperty({ description: 'Last change of this user record' })
  updatedAt: Date;
}
