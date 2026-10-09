import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationBatch1791552657837 implements MigrationInterface {
  name = 'CreateNotificationBatch1791552657837';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`notification_batch\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`client_id\` int UNSIGNED NOT NULL, \`template_id\` int UNSIGNED NOT NULL, \`channel\` varchar(20) NOT NULL, \`category\` varchar(20) NOT NULL, \`total_count\` int NOT NULL, \`status\` varchar(20) NOT NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX \`ix_notification_batch_status_updated_at\` (\`status\`, \`updated_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification_batch\` ADD CONSTRAINT \`fk_notification_batch_client\` FOREIGN KEY (\`client_id\`) REFERENCES \`api_client\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification_batch\` ADD CONSTRAINT \`fk_notification_batch_template\` FOREIGN KEY (\`template_id\`) REFERENCES \`template\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` ADD CONSTRAINT \`fk_notification_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`notification_batch\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`notification\` DROP FOREIGN KEY \`fk_notification_batch\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification_batch\` DROP FOREIGN KEY \`fk_notification_batch_template\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification_batch\` DROP FOREIGN KEY \`fk_notification_batch_client\``,
    );
    await queryRunner.query(`DROP TABLE \`notification_batch\``);
  }
}
