import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Suppression } from './suppression.entity';
import { SuppressionsService } from './suppressions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Suppression])],
  providers: [SuppressionsService],
  exports: [SuppressionsService],
})
export class SuppressionsModule {}
