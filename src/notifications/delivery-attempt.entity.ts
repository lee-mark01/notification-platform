import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Notification } from './notification.entity';
import { AttemptOutcome } from './notification.enums';

// One row per provider call. Scenario 3 (three 5xx then success) leaves four.
@Entity('delivery_attempt')
@Index(
  'uq_delivery_attempt_notification_attempt',
  ['notificationId', 'attemptNo'],
  { unique: true },
)
export class DeliveryAttempt {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'notification_id', type: 'bigint', unsigned: true })
  notificationId: number;

  @ManyToOne(() => Notification, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'notification_id',
    foreignKeyConstraintName: 'fk_delivery_attempt_notification',
  })
  notification?: Notification;

  @Column({ name: 'attempt_no', type: 'int' })
  attemptNo: number;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ type: 'varchar', length: 20 })
  outcome: AttemptOutcome;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  errorMessage: string | null;

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs: number;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt: Date;
}
