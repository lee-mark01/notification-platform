import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum EmailProviderKind {
  Fake = 'fake',
}

export enum PushProviderKind {
  Fake = 'fake',
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

  // Lets an instance serve only the API. Tests that check the QUEUED state
  // turn workers off so a job is not picked up mid-assertion.
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    parseBoolean(obj.WORKERS_ENABLED, true),
  )
  @IsBoolean()
  WORKERS_ENABLED: boolean = true;

  @IsEnum(EmailProviderKind)
  EMAIL_PROVIDER: EmailProviderKind = EmailProviderKind.Fake;

  @IsEnum(PushProviderKind)
  PUSH_PROVIDER: PushProviderKind = PushProviderKind.Fake;

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
