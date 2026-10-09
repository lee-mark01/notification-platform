import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Notification } from '../../notifications/notification.entity';
import { TemplateChannel } from '../../templates/template.entity';

export class ListInboxQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'true: unread only' })
  @IsOptional()
  // Query values are strings; only "true" and "false" are accepted.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unread?: boolean;
}

export class InboxItem {
  @ApiProperty({ example: 1024 })
  id: number;

  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiProperty({ example: '새 메시지', description: 'As sent' })
  title: string;

  @ApiProperty({ description: 'As sent (HTML for email)' })
  body: string;

  @ApiPropertyOptional({ nullable: true, type: Date })
  readAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static from(n: Notification): InboxItem {
    return {
      id: n.id,
      channel: n.channel,
      title: n.renderedTitle,
      body: n.renderedBody,
      readAt: n.readAt,
      createdAt: n.createdAt,
    };
  }
}

export class InboxPage {
  @ApiProperty({ type: [InboxItem] })
  items: InboxItem[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}

export class UnreadCount {
  @ApiProperty({ example: 3 })
  count: number;
}

export class ReadState {
  @ApiProperty({ example: 1024 })
  id: number;

  @ApiPropertyOptional({ nullable: true, type: Date })
  readAt: Date | null;
}

export class ReadAllResult {
  @ApiProperty({ example: 3, description: 'Notifications newly marked read' })
  updated: number;
}
