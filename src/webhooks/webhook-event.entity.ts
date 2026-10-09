import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Notification } from '../notifications/notification.entity';

const datetime3 = { type: 'datetime', precision: 3 } as const;

// One SES event delivered through SNS, kept as received. The unique message
// id makes a redelivered message a no-op (scenario 10). Events whose
// notification is not found yet stay unprocessed and are matched again
// later: SES can report a delivery before we have recorded SENT.
@Entity('webhook_event')
@Index('uq_webhook_event_sns_message_id', ['snsMessageId'], { unique: true })
@Index('ix_webhook_event_unprocessed', ['processedAt', 'receivedAt'])
export class WebhookEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'sns_message_id', type: 'varchar', length: 100 })
  snsMessageId: string;

  // Delivery, Bounce, Complaint, Open, ... as SES names them.
  @Column({ name: 'event_type', type: 'varchar', length: 30 })
  eventType: string;

  @Column({
    name: 'notification_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  notificationId: number | null;

  @ManyToOne(() => Notification, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'notification_id',
    foreignKeyConstraintName: 'fk_webhook_event_notification',
  })
  notification?: Notification;

  @Column({ type: 'json' })
  payload: Record<string, unknown>;

  @Column({ name: 'received_at', ...datetime3 })
  receivedAt: Date;

  @Column({ name: 'processed_at', ...datetime3, nullable: true })
  processedAt: Date | null;
}
