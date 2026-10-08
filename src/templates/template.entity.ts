import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export enum TemplateChannel {
  Email = 'email',
  Push = 'push',
}

// One row per template. Channel-specific content lives in nullable columns;
// which ones are required depends on the channel and is enforced on input.
@Entity('template')
@Index('uq_template_key', ['key'], { unique: true })
export class Template {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  // Business key used by callers, e.g. "email-verification". Unique across
  // all rows, including soft-deleted ones, so a key never changes meaning.
  @Column({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'enum', enum: TemplateChannel })
  channel: TemplateChannel;

  // Email
  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ name: 'html_body', type: 'mediumtext', nullable: true })
  htmlBody: string | null;

  @Column({ name: 'text_body', type: 'mediumtext', nullable: true })
  textBody: string | null;

  // Push
  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'json', nullable: true })
  data: Record<string, string> | null;

  @Column({ name: 'required_variables', type: 'json' })
  requiredVariables: string[];

  // Optimistic locking: exposed to clients as the ETag.
  @VersionColumn()
  version: number;

  // MySQL requires the default to use the same fractional precision.
  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
  })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', precision: 3 })
  deletedAt: Date | null;
}
