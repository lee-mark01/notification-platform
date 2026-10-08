import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { AppUser } from '../users/app-user.entity';

type UserRequest = Request & { appUser?: AppUser };

interface UserClaims {
  sub?: unknown;
  exp?: unknown;
}

/**
 * Authenticates end users by a Bearer JWT issued elsewhere (docs/design/
 * api.md): HS256 only, an expiry is required, and `sub` must name an
 * existing user.
 */
@Injectable()
export class UserJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<UserRequest>();

    const user = await this.authenticate(request.header('authorization'));
    if (!user) {
      http.getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException('A valid Bearer token is required.');
    }
    request.appUser = user;
    return true;
  }

  private async authenticate(
    header: string | undefined,
  ): Promise<AppUser | null> {
    const match = /^Bearer ([^\s]+)$/i.exec(header ?? '');
    if (!match) return null;

    let claims: UserClaims;
    try {
      // The algorithm is pinned in JwtModule's verifyOptions, so a token
      // signed with "none" or another algorithm is rejected.
      claims = await this.jwt.verifyAsync<UserClaims>(match[1]);
    } catch {
      return null;
    }
    // jsonwebtoken checks exp only when present; a token that never expires
    // would stay valid forever if leaked.
    if (typeof claims.exp !== 'number') return null;
    if (typeof claims.sub !== 'string' || !/^[1-9]\d{0,18}$/.test(claims.sub)) {
      return null;
    }
    return this.users.findOneBy({ id: Number(claims.sub) });
  }
}

/** The user authenticated by UserJwtGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AppUser => {
    const user = context.switchToHttp().getRequest<UserRequest>().appUser;
    if (!user) throw new Error('CurrentUser used without UserJwtGuard');
    return user;
  },
);
