import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// An internal service allowed to send notifications. Only the SHA-256 of its
// API key is stored.
@Entity('api_client')
@Index('uq_api_client_api_key_hash', ['apiKeyHash'], { unique: true })
export class ApiClient {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'api_key_hash', type: 'char', length: 64 })
  apiKeyHash: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
