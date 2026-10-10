import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiClient } from './api-client.entity';

const datetime3 = { type: 'datetime', precision: 3 } as const;

// One API key of a client. A client may hold several, so a key is rotated
// without downtime: add a new one, switch the caller over, revoke the old.
// Only the SHA-256 of the key is stored.
@Entity('api_key')
@Index('uq_api_key_key_hash', ['keyHash'], { unique: true })
export class ApiKey {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ name: 'client_id', type: 'int', unsigned: true })
  clientId: number;

  @ManyToOne(() => ApiClient, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'client_id',
    foreignKeyConstraintName: 'fk_api_key_client',
  })
  client?: ApiClient;

  @Column({ name: 'key_hash', type: 'char', length: 64 })
  keyHash: string;

  @CreateDateColumn({
    name: 'created_at',
    ...datetime3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;

  // NULL while the key works.
  @Column({ name: 'revoked_at', ...datetime3, nullable: true })
  revokedAt: Date | null;
}
