import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Template, TemplateChannel } from '../template.entity';

export class TemplateResponse {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'email-verification' })
  key: string;

  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiPropertyOptional({ description: 'Email only.' })
  subject?: string;

  @ApiPropertyOptional({ description: 'Email only.' })
  htmlBody?: string;

  @ApiPropertyOptional({ description: 'Email only.', nullable: true })
  textBody?: string | null;

  @ApiPropertyOptional({ description: 'Push only.' })
  title?: string;

  @ApiPropertyOptional({ description: 'Push only.' })
  body?: string;

  @ApiPropertyOptional({
    description: 'Push only.',
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
  })
  data?: Record<string, string> | null;

  @ApiProperty({ type: [String], example: ['code'] })
  requiredVariables: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  // Only the fields of the template's channel are returned; the version is
  // conveyed by the ETag header, not the body.
  static from(t: Template): TemplateResponse {
    const common = {
      id: t.id,
      key: t.key,
      channel: t.channel,
      requiredVariables: t.requiredVariables,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
    return t.channel === TemplateChannel.Email
      ? {
          ...common,
          subject: t.subject ?? undefined,
          htmlBody: t.htmlBody ?? undefined,
          textBody: t.textBody,
        }
      : {
          ...common,
          title: t.title ?? undefined,
          body: t.body ?? undefined,
          data: t.data,
        };
  }
}

export class TemplatePageResponse {
  @ApiProperty({ type: [TemplateResponse] })
  items: TemplateResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as cursor to get the next page; null on the last page.',
  })
  nextCursor: string | null;
}
