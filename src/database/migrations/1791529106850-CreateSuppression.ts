import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSuppression1791529106850 implements MigrationInterface {
  name = 'CreateSuppression1791529106850';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`suppression\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`email\` varchar(320) NOT NULL, \`reason\` varchar(20) NOT NULL, \`source\` varchar(100) NULL, \`suppressed_at\` datetime(3) NOT NULL, \`released_at\` datetime(3) NULL, UNIQUE INDEX \`uq_suppression_email\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`uq_suppression_email\` ON \`suppression\``,
    );
    await queryRunner.query(`DROP TABLE \`suppression\``);
  }
}
