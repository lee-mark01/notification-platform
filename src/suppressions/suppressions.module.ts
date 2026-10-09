import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Suppression } from './suppression.entity';
import { SuppressionsController } from './suppressions.controller';
import { SuppressionsService } from './suppressions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Suppression])],
  controllers: [SuppressionsController],
  providers: [SuppressionsService],
  exports: [SuppressionsService],
})
export class SuppressionsModule {}
