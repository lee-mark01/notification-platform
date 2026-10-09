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
import { ApiClient } from '../clients/api-client.entity';
import { NotificationCategory } from '../notifications/notification.enums';
import { Template, TemplateChannel } from '../templates/template.entity';

// Progress of putting the batch's notifications on the queue, not of sending
// them; delivery is read from the notifications themselves.
export enum BatchStatus {
  Accepted = 'ACCEPTED',
  Enqueuing = 'ENQUEUING',
  Enqueued = 'ENQUEUED',
}

const datetime3 = { type: 'datetime', precision: 3 } as const;

// One bulk send request. Each recipient becomes one notification row.
@Entity('notification_batch')
// The sweeper looks for batches whose enqueuing stopped part way.
@Index('ix_notification_batch_status_updated_at', ['status', 'updatedAt'])
export class NotificationBatch {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'client_id', type: 'int', unsigned: true })
  clientId: number;

  @ManyToOne(() => ApiClient, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'client_id',
    foreignKeyConstraintName: 'fk_notification_batch_client',
  })
  client?: ApiClient;

  @Column({ name: 'template_id', type: 'int', unsigned: true })
  templateId: number;

  @ManyToOne(() => Template, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'template_id',
    foreignKeyConstraintName: 'fk_notification_batch_template',
  })
  template?: Template;

  @Column({ type: 'varchar', length: 20 })
  channel: TemplateChannel;

  @Column({ type: 'varchar', length: 20 })
  category: NotificationCategory;

  @Column({ name: 'total_count', type: 'int' })
  totalCount: number;

  @Column({ type: 'varchar', length: 20 })
  status: BatchStatus;

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
