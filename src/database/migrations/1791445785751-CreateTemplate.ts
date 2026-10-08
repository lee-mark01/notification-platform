import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTemplate1791445785751 implements MigrationInterface {
  name = 'CreateTemplate1791445785751';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`template\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`key\` varchar(100) NOT NULL, \`channel\` enum ('email', 'push') NOT NULL, \`subject\` varchar(255) NULL, \`html_body\` mediumtext NULL, \`text_body\` mediumtext NULL, \`title\` varchar(255) NULL, \`body\` text NULL, \`data\` json NULL, \`required_variables\` json NOT NULL, \`version\` int NOT NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`deleted_at\` datetime(3) NULL, UNIQUE INDEX \`uq_template_key\` (\`key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`uq_template_key\` ON \`template\``);
    await queryRunner.query(`DROP TABLE \`template\``);
  }
}
