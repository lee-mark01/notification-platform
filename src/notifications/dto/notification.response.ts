import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateChannel } from '../../templates/template.entity';
import { DeliveryAttempt } from '../delivery-attempt.entity';
import { Notification } from '../notification.entity';
import {
  AttemptOutcome,
  NotificationCategory,
  NotificationStatus,
} from '../notification.enums';

// 202 body. Only the id: a replayed response must equal the original, and
// the status changes after acceptance, so it is read with GET instead.
export class AcceptedNotificationResponse {
  @ApiProperty({ example: 1024 })
  id: number;
}

export class DeliveryAttemptResponse {
  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ enum: AttemptOutcome })
  outcome: AttemptOutcome;

  @ApiPropertyOptional({ nullable: true, example: 'PROVIDER_5XX' })
  errorCode: string | null;

  @ApiProperty({ example: 120 })
  durationMs: number;

  @ApiProperty()
  startedAt: Date;

  static from(a: DeliveryAttempt): DeliveryAttemptResponse {
    return {
      attemptNo: a.attemptNo,
      outcome: a.outcome,
      errorCode: a.errorCode,
      durationMs: a.durationMs,
      startedAt: a.startedAt,
    };
  }
}

export class NotificationResponse {
  @ApiProperty({ example: 1024 })
  id: number;

  @ApiProperty({ enum: TemplateChannel })
  channel: TemplateChannel;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty({ enum: NotificationStatus })
  status: NotificationStatus;

  @ApiProperty({ example: 'email-verification' })
  templateKey: string;

  @ApiProperty({ example: 1 })
  templateVersion: number;

  @ApiProperty({ type: [DeliveryAttemptResponse] })
  attempts: DeliveryAttemptResponse[];

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  sentAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  deliveredAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  readAt: Date | null;

  static from(
    n: Notification,
    templateKey: string,
    attempts: DeliveryAttempt[],
  ): NotificationResponse {
    return {
      id: n.id,
      channel: n.channel,
      category: n.category,
      status: n.status,
      templateKey,
      templateVersion: n.templateVersion,
      attempts: attempts.map((a) => DeliveryAttemptResponse.from(a)),
      createdAt: n.createdAt,
      sentAt: n.sentAt,
      deliveredAt: n.deliveredAt,
      readAt: n.readAt,
    };
  }
}
