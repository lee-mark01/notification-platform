import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Suppression, SuppressionReason } from '../suppression.entity';

export class ListSuppressionsQuery {
  @ApiPropertyOptional({ description: 'Exact address (case-insensitive)' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ enum: SuppressionReason })
  @IsOptional()
  @IsEnum(SuppressionReason)
  reason?: SuppressionReason;

  @ApiPropertyOptional({
    description: 'true: still blocked, false: released',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class CreateSuppressionDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiPropertyOptional({
    example: 'Asked by phone to stop all mail',
    description: 'Why; stored as the source',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}

export class SuppressionResponse {
  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ enum: SuppressionReason })
  reason: SuppressionReason;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Notification id, SNS message id, or admin note',
  })
  source: string | null;

  @ApiProperty()
  suppressedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  releasedAt: Date | null;

  @ApiProperty({ description: 'true while mail to the address is blocked' })
  active: boolean;

  static from(s: Suppression): SuppressionResponse {
    return {
      email: s.email,
      reason: s.reason,
      source: s.source,
      suppressedAt: s.suppressedAt,
      releasedAt: s.releasedAt,
      active: s.releasedAt === null,
    };
  }
}

export class SuppressionPage {
  @ApiProperty({ type: [SuppressionResponse] })
  items: SuppressionResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}
