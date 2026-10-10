import { IsNull } from 'typeorm';
import { ApiClient } from '../clients/api-client.entity';
import { generateApiKey, hashApiKey } from '../clients/api-key';
import { ApiKey } from '../clients/api-key.entity';
import dataSource from '../database/data-source';

const USAGE = `Usage:
  npm run client:key -- list <clientId>
  npm run client:key -- add <clientId>       prints a new key once
  npm run client:key -- revoke <keyId>

Rotating without downtime: add a key, switch the service to it, then revoke
the old one. A revoked key is refused at once.`;

async function main(): Promise<void> {
  const [command, rawId] = process.argv.slice(2);
  const id = Number(rawId);
  if (
    !['list', 'add', 'revoke'].includes(command) ||
    !Number.isSafeInteger(id) ||
    id < 1
  ) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  await dataSource.initialize();
  try {
    const keys = dataSource.getRepository(ApiKey);
    if (command === 'revoke') {
      const result = await keys.update(
        { id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      console.log(
        result.affected === 1
          ? `Revoked key #${id}.`
          : `Key #${id} does not exist or is already revoked.`,
      );
      return;
    }

    const client = await dataSource.getRepository(ApiClient).findOneBy({ id });
    if (!client) {
      console.error(`API client #${id} does not exist.`);
      process.exitCode = 1;
      return;
    }

    if (command === 'add') {
      const apiKey = generateApiKey();
      const key = await keys.save({
        clientId: id,
        keyHash: hashApiKey(apiKey),
      });
      console.log(
        `Added key #${key.id} to API client #${id} (${client.name}).`,
      );
      console.log(`X-API-Key: ${apiKey}`);
      console.log('Store this key now; it cannot be shown again.');
      return;
    }

    const rows = await keys.find({
      where: { clientId: id },
      order: { id: 'ASC' },
    });
    console.log(`API client #${id} (${client.name})`);
    for (const k of rows) {
      console.log(
        `  key #${k.id}  created ${k.createdAt.toISOString()}  ${k.revokedAt ? `revoked ${k.revokedAt.toISOString()}` : 'active'}`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

void main();
