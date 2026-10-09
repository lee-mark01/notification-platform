import dataSource from '../database/data-source';
import { ApiClient } from '../clients/api-client.entity';
import { generateApiKey, hashApiKey } from '../clients/api-key';
import { ApiKey } from '../clients/api-key.entity';

// Usage: npm run client:create -- <name>
// Prints the API key once; only its hash is stored.
async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: npm run client:create -- <name>');
    process.exitCode = 1;
    return;
  }

  await dataSource.initialize();
  try {
    const apiKey = generateApiKey();
    const client = await dataSource.transaction(async (manager) => {
      const created = await manager.save(ApiClient, { name });
      await manager.save(ApiKey, {
        clientId: created.id,
        keyHash: hashApiKey(apiKey),
      });
      return created;
    });
    console.log(`Created API client #${client.id} (${name}).`);
    console.log(`X-API-Key: ${apiKey}`);
    console.log('Store this key now; it cannot be shown again.');
  } finally {
    await dataSource.destroy();
  }
}

void main();
