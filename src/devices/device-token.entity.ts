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
import { AppUser } from '../users/app-user.entity';

const datetime3 = { type: 'datetime', precision: 3 } as const;

export enum DevicePlatform {
  Web = 'web',
}

// One FCM registration token. A user may have several (browsers, devices);
// push is sent to all of the user's active tokens.
@Entity('device_token')
@Index('uq_device_token_token', ['token'], { unique: true })
@Index('ix_device_token_user_active', ['userId', 'active'])
export class DeviceToken {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_device_token_user',
  })
  user?: AppUser;

  @Column({ type: 'varchar', length: 512 })
  token: string;

  @Column({ type: 'varchar', length: 20 })
  platform: DevicePlatform;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({
    name: 'deactivation_reason',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  deactivationReason: string | null;

  @Column({ name: 'last_seen_at', ...datetime3 })
  lastSeenAt: Date;

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
