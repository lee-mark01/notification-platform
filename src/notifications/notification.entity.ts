import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationBatch } from '../batches/notification-batch.entity';
import { ApiClient } from '../clients/api-client.entity';
import { Template, TemplateChannel } from '../templates/template.entity';
import { AppUser } from '../users/app-user.entity';
import { NotificationCategory, NotificationStatus } from './notification.enums';

const datetime3 = { type: 'datetime', precision: 3 } as const;

// One row per recipient and channel. Rendered content is stored at intake so
// later template edits never change what a notification sends or shows.
@Entity('notification')
@Index('uq_notification_provider_message_id', ['providerMessageId'], {
  unique: true,
})
@Index('ix_notification_status_updated_at', ['status', 'updatedAt'])
@Index('ix_notification_user_created', ['userId', 'createdAt', 'id'])
@Index('ix_notification_user_read', ['userId', 'readAt'])
@Index('ix_notification_batch', ['batchId'])
// (created_at, id) in InnoDB: history pages read it backwards and stop
// after one page (#83).
@Index('ix_notification_created_at', ['createdAt'])
// Covers the stats queries (summary, read rates) over a period, so they never
// touch the rows (#83).
@Index('ix_notification_stats', [
  'createdAt',
  'channel',
  'category',
  'status',
  'templateId',
  'readAt',
])
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'client_id', type: 'int', unsigned: true })
  clientId: number;

  @ManyToOne(() => ApiClient, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'client_id',
    foreignKeyConstraintName: 'fk_notification_client',
  })
  client?: ApiClient;

  @Column({ name: 'batch_id', type: 'bigint', unsigned: true, nullable: true })
  batchId: number | null;

  @ManyToOne(() => NotificationBatch, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'batch_id',
    foreignKeyConstraintName: 'fk_notification_batch',
  })
  batch?: NotificationBatch;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true })
  userId: number | null;

  @ManyToOne(() => AppUser, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_notification_user',
  })
  user?: AppUser;

  @Column({ name: 'template_id', type: 'int', unsigned: true })
  templateId: number;

  @ManyToOne(() => Template, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'template_id',
    foreignKeyConstraintName: 'fk_notification_template',
  })
  template?: Template;

  @Column({ name: 'template_version', type: 'int' })
  templateVersion: number;

  @Column({ type: 'varchar', length: 20 })
  channel: TemplateChannel;

  @Column({ type: 'varchar', length: 20 })
  category: NotificationCategory;

  @Column({ type: 'varchar', length: 20 })
  status: NotificationStatus;

  @Column({
    name: 'recipient_email',
    type: 'varchar',
    length: 320,
    nullable: true,
  })
  recipientEmail: string | null;

  @Column({ type: 'json' })
  variables: Record<string, string | number | boolean>;

  @Column({ name: 'rendered_title', type: 'varchar', length: 255 })
  renderedTitle: string;

  // Email HTML or push body.
  @Column({ name: 'rendered_body', type: 'mediumtext' })
  renderedBody: string;

  // Email plain-text alternative.
  @Column({ name: 'rendered_text', type: 'mediumtext', nullable: true })
  renderedText: string | null;

  // Push data payload.
  @Column({ name: 'rendered_data', type: 'json', nullable: true })
  renderedData: Record<string, string> | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'lease_until', ...datetime3, nullable: true })
  leaseUntil: Date | null;

  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerMessageId: string | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastErrorCode: string | null;

  @Column({ name: 'queued_at', ...datetime3, nullable: true })
  queuedAt: Date | null;

  @Column({ name: 'sent_at', ...datetime3, nullable: true })
  sentAt: Date | null;

  @Column({ name: 'delivered_at', ...datetime3, nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'read_at', ...datetime3, nullable: true })
  readAt: Date | null;

  @CreateDateColumn({
    name: 'created_at',
    ...datetime3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    ...datetime3,
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
  })
  updatedAt: Date;
}
