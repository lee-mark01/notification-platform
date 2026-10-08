import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { ApiClient } from './api-client.entity';
import { hashApiKey } from './api-key';

export const API_KEY_HEADER = 'x-api-key';

type ClientRequest = Request & { apiClient?: ApiClient };

// Authenticates internal services by API key. The key is looked up by its
// SHA-256 through a unique index, so the raw key is never stored or compared.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @InjectRepository(ApiClient)
    private readonly clients: Repository<ApiClient>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<ClientRequest>();
    const apiKey = request.header(API_KEY_HEADER);

    const client = apiKey
      ? await this.clients.findOneBy({ apiKeyHash: hashApiKey(apiKey) })
      : null;
    if (!client) {
      http
        .getResponse<Response>()
        .setHeader('WWW-Authenticate', 'ApiKey header="X-API-Key"');
      throw new UnauthorizedException('A valid X-API-Key header is required.');
    }

    request.apiClient = client;
    return true;
  }
}

/** The client authenticated by ApiKeyGuard. */
export const CurrentClient = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiClient => {
    const client = context.switchToHttp().getRequest<ClientRequest>().apiClient;
    if (!client) throw new Error('CurrentClient used without ApiKeyGuard');
    return client;
  },
);
