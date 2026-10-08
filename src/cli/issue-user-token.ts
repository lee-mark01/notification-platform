import { JwtService } from '@nestjs/jwt';
import { USER_TOKEN_TTL } from '../auth/auth.module';
import dataSource from '../database/data-source';
import { validate } from '../config/env.validation';
import { AppUser } from '../users/app-user.entity';

// Usage: npm run user:token -- <email>
// Stands in for the separate auth service that issues user JWTs in a real
// deployment (docs/design/api.md): finds or creates the user and prints a
// token for local testing and the web push demo.
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run user:token -- <email>');
    process.exitCode = 1;
    return;
  }

  // data-source.ts has loaded .env into process.env.
  const env = validate(process.env);
  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(AppUser);
    const user =
      (await users.findOneBy({ email })) ??
      (await users.save({
        email,
        marketingOptIn: false,
        marketingOptInAt: null,
      }));
    const token = new JwtService().sign(
      { sub: String(user.id) },
      {
        secret: env.JWT_SECRET,
        algorithm: 'HS256',
        expiresIn: USER_TOKEN_TTL,
      },
    );
    console.log(
      `User #${user.id} (${email}), token valid for ${USER_TOKEN_TTL}:`,
    );
    console.log(token);
  } finally {
    await dataSource.destroy();
  }
}

void main();
