import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Notification } from '../../../notifications/notification.entity';
import { NotificationCategory } from '../../../notifications/notification.enums';
import { TemplateChannel } from '../../../templates/template.entity';

export class ListDlqQuery {
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
}

export class DeadNotificationResponse {
  @ApiProperty({ example: 1024 })
  id: number;

  @ApiProperty({ example: 3 })
  clientId: number;

  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty({ example: 'email-verification' })
  templateKey: string;

  @ApiProperty({ example: 5, description: 'Attempts made so far, all jobs' })
  attemptCount: number;

  @ApiPropertyOptional({ nullable: true, example: 'TooManyRequestsException' })
  lastErrorCode: string | null;

  @ApiProperty({ description: 'When it became DEAD' })
  deadAt: Date;

  static from(n: Notification): DeadNotificationResponse {
    return {
      id: n.id,
      clientId: n.clientId,
      channel: n.channel,
      category: n.category,
      templateKey: n.template?.key ?? '',
      attemptCount: n.attemptCount,
      lastErrorCode: n.lastErrorCode,
      deadAt: n.updatedAt,
    };
  }
}

export class DlqPageResponse {
  @ApiProperty({ type: [DeadNotificationResponse] })
  items: DeadNotificationResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}

export class RedriveDto {
  @ApiProperty({ type: [Number], example: [1024, 1025], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  notificationIds: number[];
}

export class RedriveResponse {
  @ApiProperty({ example: 1, description: 'Moved back to QUEUED' })
  redriven: number;

  @ApiProperty({
    type: [Number],
    example: [1025],
    description: 'Not DEAD or not found, left unchanged',
  })
  skipped: number[];
}
