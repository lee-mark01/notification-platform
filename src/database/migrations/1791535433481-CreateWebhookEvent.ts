import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookEvent1791535433481 implements MigrationInterface {
  name = 'CreateWebhookEvent1791535433481';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`webhook_event\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`sns_message_id\` varchar(100) NOT NULL, \`event_type\` varchar(30) NOT NULL, \`notification_id\` bigint UNSIGNED NULL, \`payload\` json NOT NULL, \`received_at\` datetime(3) NOT NULL, \`processed_at\` datetime(3) NULL, INDEX \`ix_webhook_event_unprocessed\` (\`processed_at\`, \`received_at\`), UNIQUE INDEX \`uq_webhook_event_sns_message_id\` (\`sns_message_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`webhook_event\` ADD CONSTRAINT \`fk_webhook_event_notification\` FOREIGN KEY (\`notification_id\`) REFERENCES \`notification\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`webhook_event\` DROP FOREIGN KEY \`fk_webhook_event_notification\``,
    );
    await queryRunner.query(`DROP TABLE \`webhook_event\``);
  }
}
