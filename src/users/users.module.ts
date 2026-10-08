import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppUser } from './app-user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AppUser])],
  exports: [TypeOrmModule],
})
export class UsersModule {}
