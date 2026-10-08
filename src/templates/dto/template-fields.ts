import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// FCM data payloads only carry string values.
function IsStringRecord(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isStringRecord',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.values(value).every((v) => typeof v === 'string'),
        defaultMessage: () => '$property must be an object of string values',
      },
    },
    options,
  );
}

// Content fields are optional at the DTO level; which ones a channel requires
// or forbids is checked by checkTemplateContent().
const optionalText = (maxLength: number, description: string) =>
  applyDecorators(
    ApiPropertyOptional({ description, maxLength, nullable: true }),
    IsOptional(),
    IsString(),
    IsNotEmpty(),
    MaxLength(maxLength),
  );

export const TemplateFields = {
  subject: () => optionalText(255, 'Email subject. Required for email.'),
  htmlBody: () => optionalText(100_000, 'Email HTML body. Required for email.'),
  textBody: () => optionalText(100_000, 'Email plain-text body (optional).'),
  title: () => optionalText(255, 'Push title. Required for push.'),
  body: () => optionalText(16_000, 'Push body. Required for push.'),
  data: () =>
    applyDecorators(
      ApiPropertyOptional({
        description: 'Push data payload; values must be strings (FCM).',
        type: 'object',
        additionalProperties: { type: 'string' },
        nullable: true,
        example: { screen: 'inbox' },
      }),
      IsOptional(),
      IsObject(),
      IsStringRecord(),
    ),
  requiredVariables: () =>
    applyDecorators(
      ApiPropertyOptional({
        description: 'Variable names a render request must supply.',
        type: [String],
        example: ['userName', 'code'],
      }),
      IsOptional(),
      IsArray(),
      ArrayMaxSize(50),
      ArrayUnique(),
      IsString({ each: true }),
      Matches(VARIABLE_NAME, {
        each: true,
        message: 'each requiredVariables entry must be a valid identifier',
      }),
    ),
};
