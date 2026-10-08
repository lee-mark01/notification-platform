import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, Matches, MaxLength } from 'class-validator';
import { TemplateChannel } from '../template.entity';
import { TemplateFields } from './template-fields';

export class CreateTemplateDto {
  @ApiProperty({
    description: 'Unique, immutable key callers use to pick the template.',
    example: 'email-verification',
    maxLength: 100,
  })
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'key must be lowercase letters and digits separated by hyphens',
  })
  key: string;

  @ApiProperty({ enum: TemplateChannel, description: 'Immutable.' })
  @IsEnum(TemplateChannel)
  channel: TemplateChannel;

  @TemplateFields.subject()
  subject?: string;

  @TemplateFields.htmlBody()
  htmlBody?: string;

  @TemplateFields.textBody()
  textBody?: string;

  @TemplateFields.title()
  title?: string;

  @TemplateFields.body()
  body?: string;

  @TemplateFields.data()
  data?: Record<string, string>;

  @TemplateFields.requiredVariables()
  requiredVariables?: string[];
}
