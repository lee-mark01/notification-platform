import { Module } from '@nestjs/common';
import { FakeProvider } from './fake/fake.provider';
import { ProviderRegistry } from './provider-registry';

@Module({
  providers: [FakeProvider, ProviderRegistry],
  exports: [ProviderRegistry, FakeProvider],
})
export class ProvidersModule {}
