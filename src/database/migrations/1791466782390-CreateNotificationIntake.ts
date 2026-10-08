import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationIntake1791466782390 implements MigrationInterface {
  name = 'CreateNotificationIntake1791466782390';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`api_client\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(100) NOT NULL, \`api_key_hash\` char(64) NOT NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`uq_api_client_api_key_hash\` (\`api_key_hash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`app_user\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`email\` varchar(320) NOT NULL, \`marketing_opt_in\` tinyint NOT NULL DEFAULT 0, \`marketing_opt_in_at\` datetime(3) NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE INDEX \`uq_app_user_email\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`notification\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`client_id\` int UNSIGNED NOT NULL, \`batch_id\` bigint UNSIGNED NULL, \`user_id\` bigint UNSIGNED NULL, \`template_id\` int UNSIGNED NOT NULL, \`template_version\` int NOT NULL, \`channel\` varchar(20) NOT NULL, \`category\` varchar(20) NOT NULL, \`status\` varchar(20) NOT NULL, \`recipient_email\` varchar(320) NULL, \`variables\` json NOT NULL, \`rendered_title\` varchar(255) NOT NULL, \`rendered_body\` mediumtext NOT NULL, \`rendered_text\` mediumtext NULL, \`rendered_data\` json NULL, \`attempt_count\` int NOT NULL DEFAULT '0', \`lease_until\` datetime(3) NULL, \`provider_message_id\` varchar(255) NULL, \`last_error_code\` varchar(64) NULL, \`queued_at\` datetime(3) NULL, \`sent_at\` datetime(3) NULL, \`delivered_at\` datetime(3) NULL, \`read_at\` datetime(3) NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX \`ix_notification_created_channel\` (\`created_at\`, \`channel\`, \`category\`, \`status\`), INDEX \`ix_notification_batch\` (\`batch_id\`), INDEX \`ix_notification_user_read\` (\`user_id\`, \`read_at\`), INDEX \`ix_notification_user_created\` (\`user_id\`, \`created_at\`, \`id\`), INDEX \`ix_notification_status_updated_at\` (\`status\`, \`updated_at\`), UNIQUE INDEX \`uq_notification_provider_message_id\` (\`provider_message_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`delivery_attempt\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`notification_id\` bigint UNSIGNED NOT NULL, \`attempt_no\` int NOT NULL, \`provider\` varchar(20) NOT NULL, \`outcome\` varchar(20) NOT NULL, \`error_code\` varchar(64) NULL, \`error_message\` varchar(500) NULL, \`duration_ms\` int NOT NULL, \`started_at\` datetime(3) NOT NULL, UNIQUE INDEX \`uq_delivery_attempt_notification_attempt\` (\`notification_id\`, \`attempt_no\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`idempotency_key\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`client_id\` int UNSIGNED NOT NULL, \`idem_key\` varchar(255) NOT NULL, \`request_hash\` char(64) NOT NULL, \`status\` varchar(20) NOT NULL, \`locked_until\` datetime(3) NOT NULL, \`response_status\` smallint UNSIGNED NULL, \`response_body\` json NULL, \`notification_id\` bigint UNSIGNED NULL, \`expires_at\` datetime(3) NOT NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX \`ix_idempotency_key_expires_at\` (\`expires_at\`), UNIQUE INDEX \`uq_idempotency_key_client_key\` (\`client_id\`, \`idem_key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` ADD CONSTRAINT \`fk_notification_client\` FOREIGN KEY (\`client_id\`) REFERENCES \`api_client\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` ADD CONSTRAINT \`fk_notification_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`app_user\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` ADD CONSTRAINT \`fk_notification_template\` FOREIGN KEY (\`template_id\`) REFERENCES \`template\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`delivery_attempt\` ADD CONSTRAINT \`fk_delivery_attempt_notification\` FOREIGN KEY (\`notification_id\`) REFERENCES \`notification\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`idempotency_key\` ADD CONSTRAINT \`fk_idempotency_key_client\` FOREIGN KEY (\`client_id\`) REFERENCES \`api_client\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`idempotency_key\` DROP FOREIGN KEY \`fk_idempotency_key_client\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`delivery_attempt\` DROP FOREIGN KEY \`fk_delivery_attempt_notification\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` DROP FOREIGN KEY \`fk_notification_template\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` DROP FOREIGN KEY \`fk_notification_user\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` DROP FOREIGN KEY \`fk_notification_client\``,
    );
    await queryRunner.query(
      `DROP INDEX \`uq_idempotency_key_client_key\` ON \`idempotency_key\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_idempotency_key_expires_at\` ON \`idempotency_key\``,
    );
    await queryRunner.query(`DROP TABLE \`idempotency_key\``);
    await queryRunner.query(
      `DROP INDEX \`uq_delivery_attempt_notification_attempt\` ON \`delivery_attempt\``,
    );
    await queryRunner.query(`DROP TABLE \`delivery_attempt\``);
    await queryRunner.query(
      `DROP INDEX \`uq_notification_provider_message_id\` ON \`notification\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_notification_status_updated_at\` ON \`notification\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_notification_user_created\` ON \`notification\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_notification_user_read\` ON \`notification\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_notification_batch\` ON \`notification\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_notification_created_channel\` ON \`notification\``,
    );
    await queryRunner.query(`DROP TABLE \`notification\``);
    await queryRunner.query(`DROP INDEX \`uq_app_user_email\` ON \`app_user\``);
    await queryRunner.query(`DROP TABLE \`app_user\``);
    await queryRunner.query(
      `DROP INDEX \`uq_api_client_api_key_hash\` ON \`api_client\``,
    );
    await queryRunner.query(`DROP TABLE \`api_client\``);
  }
}
