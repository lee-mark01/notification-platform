import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { TemplateChannel } from '../../templates/template.entity';
import { VARIABLE_NAME } from '../../templates/dto/template-fields';
import { NotificationCategory } from '../notification.enums';

const MAX_VARIABLES = 50;
const MAX_STRING_VALUE = 2000;

// Flat map of identifier -> string | number | boolean, matching what
// templates can reference with {{name}}.
export function IsTemplateVariables() {
  return ValidateBy({
    name: 'isTemplateVariables',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          return false;
        const entries = Object.entries(value);
        return (
          entries.length <= MAX_VARIABLES &&
          entries.every(
            ([key, v]) =>
              VARIABLE_NAME.test(key) &&
              ((typeof v === 'string' && v.length <= MAX_STRING_VALUE) ||
                (typeof v === 'number' && Number.isFinite(v)) ||
                typeof v === 'boolean'),
          )
        );
      },
      defaultMessage: () =>
        `variables must be an object of at most ${MAX_VARIABLES} identifier keys with string (≤${MAX_STRING_VALUE} chars), number, or boolean values`,
    },
  });
}

export class RecipientDto {
  @ApiPropertyOptional({
    example: 42,
    description: 'Required for push. For email, the user’s address is used.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'Email only. Takes precedence over userId.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;
}

export class CreateNotificationDto {
  @ApiProperty({ enum: TemplateChannel })
  @IsEnum(TemplateChannel)
  channel: TemplateChannel;

  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiProperty({ example: 'email-verification' })
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'templateKey must be lowercase letters and digits separated by hyphens',
  })
  templateKey: string;

  @ApiProperty({ type: RecipientDto })
  @ValidateNested()
  @Type(() => RecipientDto)
  recipient: RecipientDto;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    },
    example: { code: '381920' },
  })
  @IsOptional()
  @IsTemplateVariables()
  variables?: Record<string, string | number | boolean>;
}
