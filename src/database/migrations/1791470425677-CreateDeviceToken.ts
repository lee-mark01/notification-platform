import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeviceToken1791470425677 implements MigrationInterface {
  name = 'CreateDeviceToken1791470425677';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`device_token\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`token\` varchar(512) NOT NULL, \`platform\` varchar(20) NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`deactivation_reason\` varchar(64) NULL, \`last_seen_at\` datetime(3) NOT NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX \`ix_device_token_user_active\` (\`user_id\`, \`active\`), UNIQUE INDEX \`uq_device_token_token\` (\`token\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`device_token\` ADD CONSTRAINT \`fk_device_token_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`app_user\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`device_token\` DROP FOREIGN KEY \`fk_device_token_user\``,
    );
    await queryRunner.query(
      `DROP INDEX \`uq_device_token_token\` ON \`device_token\``,
    );
    await queryRunner.query(
      `DROP INDEX \`ix_device_token_user_active\` ON \`device_token\``,
    );
    await queryRunner.query(`DROP TABLE \`device_token\``);
  }
}
