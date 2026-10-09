import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsTemplateVariables } from '../../notifications/dto/create-notification.dto';
import type { RenderedContent } from '../rendering/template-renderer';
import { TemplateChannel } from '../template.entity';

export class PreviewTemplateDto {
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

// Exactly what a notification would store and send with these variables.
export class TemplatePreviewResponse {
  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiPropertyOptional({ nullable: true, description: 'Email only' })
  subject: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Email only' })
  html: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Email only' })
  text: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Push only' })
  title: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Push only' })
  body: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Push only',
  })
  data: Record<string, string> | null;

  static from(r: RenderedContent): TemplatePreviewResponse {
    return r.channel === TemplateChannel.Email
      ? {
          channel: r.channel,
          subject: r.subject,
          html: r.html,
          text: r.text,
          title: null,
          body: null,
          data: null,
        }
      : {
          channel: r.channel,
          subject: null,
          html: null,
          text: null,
          title: r.title,
          body: r.body,
          data: r.data,
        };
  }
}
