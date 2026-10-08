import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsString, ValidateNested } from 'class-validator';
import { ProblemTypes } from '../../src/common/problem/problem-types';
import { ProblemException } from '../../src/common/problem/problem.exception';

class ProbeRecipientDto {
  @IsEmail()
  email: string;
}

export class ProbeRequestDto {
  @IsIn(['email', 'push'])
  channel: string;

  @ValidateNested()
  @Type(() => ProbeRecipientDto)
  recipient: ProbeRecipientDto;

  @IsString()
  templateKey: string;
}

// Test-only endpoints that exercise the global pipe and filter.
@Controller('__probe')
export class ProblemProbeController {
  @Post('validate')
  @HttpCode(200)
  validate(@Body() body: ProbeRequestDto): { ok: true; isDto: boolean } {
    return { ok: true, isDto: body instanceof ProbeRequestDto };
  }

  @Get('crash')
  crash(): never {
    throw new Error('connection string password=hunter2');
  }

  @Get('problem/:name')
  problem(@Param('name') name: keyof typeof ProblemTypes): never {
    throw new ProblemException(ProblemTypes[name]);
  }
}
