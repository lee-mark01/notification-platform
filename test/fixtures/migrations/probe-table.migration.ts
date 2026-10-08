import { MigrationInterface, QueryRunner } from 'typeorm';

// Test-only migration. The timestamp sorts after every real migration.
export class ProbeTable9999999999999 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE e2e_probe (id INT NOT NULL PRIMARY KEY)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE e2e_probe');
  }
}
