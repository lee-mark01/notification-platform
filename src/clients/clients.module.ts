import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiClient } from './api-client.entity';
import { ApiKeyGuard } from './api-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ApiClient])],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard, TypeOrmModule],
})
export class ClientsModule {}
