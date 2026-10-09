import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum EmailProviderKind {
  Fake = 'fake',
  Ses = 'ses',
}

export enum PushProviderKind {
  Fake = 'fake',
  Fcm = 'fcm',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  DB_PORT: number;

  @IsString()
  @IsNotEmpty()
  DB_DATABASE: string;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  REDIS_PORT: number;

  // Implicit conversion would turn the string "false" into true, so booleans
  // are parsed explicitly. Anything other than true/false fails validation.
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    parseBoolean(obj.SWAGGER_ENABLED, false),
  )
  @IsBoolean()
  SWAGGER_ENABLED: boolean = false;

  // HS256 key for user JWTs (sub = user id). 32+ characters so it is not
  // guessable offline from a captured token.
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  // Shared key for /admin APIs (X-Admin-Key), compared in constant time.
  @IsString()
  @MinLength(32)
  ADMIN_API_KEY: string;

  // Lets an instance serve only the API. Tests that check the QUEUED state
  // turn workers off so a job is not picked up mid-assertion.
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    parseBoolean(obj.WORKERS_ENABLED, true),
  )
  @IsBoolean()
  WORKERS_ENABLED: boolean = true;

  @IsEnum(EmailProviderKind)
  EMAIL_PROVIDER: EmailProviderKind = EmailProviderKind.Fake;

  // Required only when SES sends email.
  @ValidateIf(
    (env: EnvironmentVariables) => env.EMAIL_PROVIDER === EmailProviderKind.Ses,
  )
  @IsString()
  @IsNotEmpty()
  AWS_REGION?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.EMAIL_PROVIDER === EmailProviderKind.Ses,
  )
  @IsString()
  @IsNotEmpty()
  SES_FROM_ADDRESS?: string;

  // Optional: without them the AWS SDK's default chain (IAM role) is used.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  AWS_ACCESS_KEY_ID?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.AWS_ACCESS_KEY_ID !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  AWS_SECRET_ACCESS_KEY?: string;

  @IsEnum(PushProviderKind)
  PUSH_PROVIDER: PushProviderKind = PushProviderKind.Fake;

  // Required only when FCM sends push. A path to the service account JSON,
  // kept outside the repository.
  @ValidateIf(
    (env: EnvironmentVariables) => env.PUSH_PROVIDER === PushProviderKind.Fcm,
  )
  @IsString()
  @IsNotEmpty()
  GOOGLE_APPLICATION_CREDENTIALS?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.PUSH_PROVIDER === PushProviderKind.Fcm,
  )
  @IsString()
  @IsNotEmpty()
  FIREBASE_PROJECT_ID?: string;

  // Comma-separated browser origins allowed to call the API (the web push
  // demo page). Empty disables CORS.
  @IsString()
  CORS_ORIGINS: string = '';

  // Attempts per send job, including the first. Transient failures retry
  // with an exponential backoff from RETRY_BASE_DELAY_MS (1x, 2x, 4x, ...)
  // with jitter; after the last attempt the notification is DEAD.
  @IsInt()
  @Min(1)
  @Max(20)
  SEND_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(0)
  RETRY_BASE_DELAY_MS: number = 2_000;

  // Sweeper (ADR-0003): how often it runs, and how long a notification may
  // sit in PENDING, or in QUEUED/RETRYING/SENDING, before it is checked.
  @IsInt()
  @Min(1_000)
  SWEEP_INTERVAL_MS: number = 30_000;

  @IsInt()
  @Min(0)
  SWEEP_PENDING_AFTER_MS: number = 60_000;

  @IsInt()
  @Min(0)
  SWEEP_STUCK_AFTER_MS: number = 600_000;

  // Fixed delay per fake send, for load tests (D10).
  @IsInt()
  @Min(0)
  FAKE_PROVIDER_LATENCY_MS: number = 0;
}

function parseBoolean(value: unknown, fallback: boolean): unknown {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n  ');
    throw new Error(`Invalid environment variables:\n  ${details}`);
  }
  return validated;
}
