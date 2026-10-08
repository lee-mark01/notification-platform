import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/env.validation';
import { UsersModule } from '../users/users.module';
import { UserJwtGuard } from './user-jwt.guard';

export const USER_TOKEN_TTL = '1h';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', expiresIn: USER_TOKEN_TTL },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [UserJwtGuard],
  exports: [UserJwtGuard, JwtModule, UsersModule],
})
export class AuthModule {}
