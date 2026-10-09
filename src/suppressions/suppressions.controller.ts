import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { isEmail } from 'class-validator';
import type { Response } from 'express';
import { AdminKeyGuard } from '../admin/admin-key.guard';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { ProblemException } from '../common/problem/problem.exception';
import {
  CreateSuppressionDto,
  ListSuppressionsQuery,
  SuppressionPage,
  SuppressionResponse,
} from './dto/suppression.dto';
import { SuppressionReason } from './suppression.entity';
import { SuppressionsService } from './suppressions.service';

@ApiTags('admin: suppressions')
@ApiSecurity('admin-key')
@ApiUnauthorizedResponse({ description: 'Missing or wrong X-Admin-Key' })
@Controller('admin/suppressions')
@UseGuards(AdminKeyGuard)
export class SuppressionsController {
  constructor(private readonly suppressions: SuppressionsService) {}

  @Get()
  @ApiOperation({ summary: 'List suppressed addresses, newest first' })
  @ApiOkResponse({ type: SuppressionPage })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  list(@Query() query: ListSuppressionsQuery): Promise<SuppressionPage> {
    return this.suppressions.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Block an address',
    description:
      '201 when newly blocked (or blocked again after a release), 200 when it already was; an existing block keeps its reason.',
  })
  @ApiCreatedResponse({ type: SuppressionResponse })
  @ApiOkResponse({ type: SuppressionResponse })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  async create(
    @Body() dto: CreateSuppressionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuppressionResponse> {
    const outcome = await this.suppressions.suppress(
      dto.email,
      SuppressionReason.Admin,
      dto.note ?? 'admin',
    );
    res.status(outcome === 'unchanged' ? HttpStatus.OK : HttpStatus.CREATED);
    const row = await this.suppressions.findByEmail(dto.email);
    return SuppressionResponse.from(row!);
  }

  @Delete(':email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unblock an address',
    description: 'The row is kept with releasedAt as a record.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  async release(@Param('email') email: string): Promise<void> {
    if (!isEmail(email)) {
      throw new ProblemException(
        ProblemTypes.VALIDATION_FAILED,
        'One or more fields are invalid.',
        { errors: [{ field: 'email', message: 'email must be an email' }] },
      );
    }
    if (!(await this.suppressions.release(email))) {
      throw new ProblemException(
        ProblemTypes.RESOURCE_NOT_FOUND,
        `${email} is not suppressed.`,
      );
    }
  }
}
