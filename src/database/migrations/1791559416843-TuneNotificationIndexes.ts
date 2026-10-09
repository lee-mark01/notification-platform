import { MigrationInterface, QueryRunner } from 'typeorm';

// Measured on 1,000,000 rows (load/explain, #83): history pages need
// (created_at, id) order, and the stats queries need an index that covers
// template_id and read_at as well.
export class TuneNotificationIndexes1791559416843 implements MigrationInterface {
  name = 'TuneNotificationIndexes1791559416843';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`ix_notification_created_channel\` ON \`notification\``,
    );
    await queryRunner.query(
      `CREATE INDEX \`ix_notification_created_at\` ON \`notification\` (\`created_at\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`ix_notification_stats\` ON \`notification\` (\`created_at\`, \`channel\`, \`category\`, \`status\`, \`template_id\`, \`read_at\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`ix_notification_stats\` ON \`notification\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_notification_created_at\` ON \`notification\``,
    );
    await queryRunner.query(
      `CREATE INDEX \`ix_notification_created_channel\` ON \`notification\` (\`created_at\`, \`channel\`, \`category\`, \`status\`)`,
    );
  }
}
