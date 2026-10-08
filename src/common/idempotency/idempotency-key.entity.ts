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
import { ApiClient } from '../../clients/api-client.entity';

export enum IdempotencyStatus {
  InProgress = 'IN_PROGRESS',
  Completed = 'COMPLETED',
}

const datetime3 = { type: 'datetime', precision: 3 } as const;

// One row per (client, Idempotency-Key). See docs/design/state-machine.md.
@Entity('idempotency_key')
@Index('uq_idempotency_key_client_key', ['clientId', 'idemKey'], {
  unique: true,
})
@Index('ix_idempotency_key_expires_at', ['expiresAt'])
export class IdempotencyKey {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'client_id', type: 'int', unsigned: true })
  clientId: number;

  @ManyToOne(() => ApiClient, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'client_id',
    foreignKeyConstraintName: 'fk_idempotency_key_client',
  })
  client?: ApiClient;

  @Column({ name: 'idem_key', type: 'varchar', length: 255 })
  idemKey: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash: string;

  @Column({ type: 'varchar', length: 20 })
  status: IdempotencyStatus;

  @Column({ name: 'locked_until', ...datetime3 })
  lockedUntil: Date;

  @Column({
    name: 'response_status',
    type: 'smallint',
    unsigned: true,
    nullable: true,
  })
  responseStatus: number | null;

  @Column({ name: 'response_body', type: 'json', nullable: true })
  responseBody: Record<string, unknown> | null;

  @Column({
    name: 'notification_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  notificationId: number | null;

  @Column({ name: 'expires_at', ...datetime3 })
  expiresAt: Date;

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
