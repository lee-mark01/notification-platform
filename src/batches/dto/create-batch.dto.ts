import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  IsTemplateVariables,
  RecipientDto,
} from '../../notifications/dto/create-notification.dto';
import { NotificationCategory } from '../../notifications/notification.enums';
import { TemplateChannel } from '../../templates/template.entity';

export const MAX_BATCH_RECIPIENTS = 10_000;

export class BatchRecipientDto extends RecipientDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    },
    example: { name: 'A' },
  })
  @IsOptional()
  @IsTemplateVariables()
  variables?: Record<string, string | number | boolean>;
}

export class CreateBatchDto {
  @ApiProperty({ enum: TemplateChannel })
  @IsEnum(TemplateChannel)
  channel: TemplateChannel;

  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiProperty({ example: 'weekly-digest' })
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'templateKey must be lowercase letters and digits separated by hyphens',
  })
  templateKey: string;

  @ApiProperty({
    type: [BatchRecipientDto],
    minItems: 1,
    maxItems: MAX_BATCH_RECIPIENTS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_RECIPIENTS)
  @ValidateNested({ each: true })
  @Type(() => BatchRecipientDto)
  recipients: BatchRecipientDto[];
}
