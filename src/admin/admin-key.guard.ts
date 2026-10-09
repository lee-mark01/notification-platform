import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { EnvironmentVariables } from '../config/env.validation';

export const ADMIN_KEY_HEADER = 'x-admin-key';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * A constant-time check against the admin key, for places outside Nest's
 * guards (the Bull Board mount). Both sides are hashed first so
 * timingSafeEqual compares equal-length buffers.
 */
export function adminKeyMatcher(
  key: string,
): (given: string | undefined) => boolean {
  const expected = digest(key);
  return (given) =>
    given !== undefined && timingSafeEqual(digest(given), expected);
}

/**
 * Protects operator APIs with one shared key. The comparison time does not
 * reveal how many leading characters matched.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  private readonly matches: (given: string | undefined) => boolean;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.matches = adminKeyMatcher(
      config.get('ADMIN_API_KEY', { infer: true }),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const given = http.getRequest<Request>().header(ADMIN_KEY_HEADER);
    if (this.matches(given)) return true;

    http
      .getResponse<Response>()
      .setHeader('WWW-Authenticate', 'AdminKey header="X-Admin-Key"');
    throw new UnauthorizedException('A valid X-Admin-Key header is required.');
  }
}
