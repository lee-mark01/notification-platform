import { MigrationInterface, QueryRunner } from 'typeorm';

// Moves each client's key into api_key so a client can hold several keys
// and have one revoked. Existing keys keep working: their hashes are copied
// as they are.
export class SplitApiKeys1791578838865 implements MigrationInterface {
  name = 'SplitApiKeys1791578838865';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`api_key\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`client_id\` int UNSIGNED NOT NULL, \`key_hash\` char(64) NOT NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`revoked_at\` datetime(3) NULL, UNIQUE INDEX \`uq_api_key_key_hash\` (\`key_hash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`api_key\` ADD CONSTRAINT \`fk_api_key_client\` FOREIGN KEY (\`client_id\`) REFERENCES \`api_client\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `INSERT INTO \`api_key\` (\`client_id\`, \`key_hash\`, \`created_at\`) SELECT \`id\`, \`api_key_hash\`, \`created_at\` FROM \`api_client\``,
    );
    await queryRunner.query(
      `DROP INDEX \`uq_api_client_api_key_hash\` ON \`api_client\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`api_client\` DROP COLUMN \`api_key_hash\``,
    );
  }

  // Back to one key per client: the newest key that is not revoked. A client
  // with only revoked keys keeps its newest one, so the column can be filled.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`api_client\` ADD \`api_key_hash\` char(64) NULL`,
    );
    await queryRunner.query(
      `UPDATE \`api_client\` c SET c.\`api_key_hash\` = (SELECT k.\`key_hash\` FROM \`api_key\` k WHERE k.\`client_id\` = c.\`id\` ORDER BY k.\`revoked_at\` IS NULL DESC, k.\`id\` DESC LIMIT 1)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`api_client\` MODIFY \`api_key_hash\` char(64) NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`uq_api_client_api_key_hash\` ON \`api_client\` (\`api_key_hash\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`api_key\` DROP FOREIGN KEY \`fk_api_key_client\``,
    );
    await queryRunner.query(`DROP TABLE \`api_key\``);
  }
}
