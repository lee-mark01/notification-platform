import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const datetime3 = { type: 'datetime', precision: 3 } as const;

export enum SuppressionReason {
  HardBounce = 'HARD_BOUNCE',
  Complaint = 'COMPLAINT',
  InvalidAddress = 'INVALID_ADDRESS',
  Admin = 'ADMIN',
}

// An email address that must not receive mail, whatever the category. One
// row per address: suppressing again after a release updates the same row.
@Entity('suppression')
@Index('uq_suppression_email', ['email'], { unique: true })
export class Suppression {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  // Stored lower-cased (normalizeEmail) so lookups match regardless of case.
  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ type: 'varchar', length: 20 })
  reason: SuppressionReason;

  // What caused it: a notification id, an SNS MessageId, an admin id.
  @Column({ type: 'varchar', length: 100, nullable: true })
  source: string | null;

  @Column({ name: 'suppressed_at', ...datetime3 })
  suppressedAt: Date;

  // NULL while the address is blocked.
  @Column({ name: 'released_at', ...datetime3, nullable: true })
  releasedAt: Date | null;
}
