import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Notification } from '../../notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../notifications/notification.enums';
import { TemplateChannel } from '../../templates/template.entity';

export class SearchNotificationsQuery {
  @ApiPropertyOptional({
    description: 'Start (inclusive). Default: 7 days before to',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    description: 'End (exclusive). Default: now. At most 92 days after from',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: TemplateChannel })
  @IsOptional()
  @IsEnum(TemplateChannel)
  channel?: TemplateChannel;

  @ApiPropertyOptional({ enum: NotificationCategory })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({
    description: 'One or more, comma-separated',
    example: 'FAILED,DEAD',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((s) => s.trim()) : value,
  )
  @IsEnum(NotificationStatus, { each: true })
  status?: NotificationStatus[];

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  clientId?: number;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({ description: 'Recipient address, exact match' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ example: 'email-verification' })
  @IsOptional()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  templateKey?: string;

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

export class NotificationHistoryItem {
  @ApiProperty({ example: 1024 })
  id: number;

  @ApiProperty({ example: 3 })
  clientId: number;

  @ApiPropertyOptional({ nullable: true, example: 7 })
  batchId: number | null;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  userId: number | null;

  @ApiPropertyOptional({ nullable: true, example: 'user@example.com' })
  recipientEmail: string | null;

  @ApiProperty({ example: 'email-verification' })
  templateKey: string;

  @ApiProperty({ example: 1 })
  templateVersion: number;

  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty({ enum: NotificationStatus })
  status: NotificationStatus;

  @ApiProperty({ example: 1 })
  attemptCount: number;

  @ApiPropertyOptional({ nullable: true, example: 'PROVIDER_5XX' })
  lastErrorCode: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  sentAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  deliveredAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  readAt: Date | null;

  static from(n: Notification, templateKey: string): NotificationHistoryItem {
    return {
      id: n.id,
      clientId: n.clientId,
      batchId: n.batchId,
      userId: n.userId,
      recipientEmail: n.recipientEmail,
      templateKey,
      templateVersion: n.templateVersion,
      channel: n.channel,
      category: n.category,
      status: n.status,
      attemptCount: n.attemptCount,
      lastErrorCode: n.lastErrorCode,
      createdAt: n.createdAt,
      sentAt: n.sentAt,
      deliveredAt: n.deliveredAt,
      readAt: n.readAt,
    };
  }
}

export class NotificationHistoryPage {
  @ApiProperty({ type: [NotificationHistoryItem] })
  items: NotificationHistoryItem[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}
