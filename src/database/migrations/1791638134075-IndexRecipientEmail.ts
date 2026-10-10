import { MigrationInterface, QueryRunner } from 'typeorm';

// History search by recipient address, used to trace "my mail never came":
// without it a 92-day search read every row in the period (load/explain, #107).
export class IndexRecipientEmail1791638134075 implements MigrationInterface {
  name = 'IndexRecipientEmail1791638134075';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX \`ix_notification_email_created\` ON \`notification\` (\`recipient_email\`, \`created_at\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`ix_notification_email_created\` ON \`notification\``,
    );
  }
}
