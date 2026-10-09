import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiProblemResponse } from '../../common/problem/problem-details.dto';
import { ProblemTypes } from '../../common/problem/problem-types';
import { AdminKeyGuard } from '../admin-key.guard';
import { DlqService } from './dlq.service';
import {
  DlqPageResponse,
  ListDlqQuery,
  RedriveDto,
  RedriveResponse,
} from './dto/dlq.dto';

@ApiTags('admin: dlq')
@ApiSecurity('admin-key')
@ApiUnauthorizedResponse({ description: 'Missing or wrong X-Admin-Key' })
@Controller('admin/dlq')
@UseGuards(AdminKeyGuard)
export class DlqController {
  constructor(private readonly dlq: DlqService) {}

  @Get()
  @ApiOperation({ summary: 'List DEAD notifications, oldest first' })
  @ApiOkResponse({ type: DlqPageResponse })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  list(@Query() query: ListDlqQuery): Promise<DlqPageResponse> {
    return this.dlq.list(query);
  }

  @Post('redrive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move DEAD notifications back to QUEUED and queue them again',
  })
  @ApiOkResponse({ type: RedriveResponse })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  redrive(@Body() dto: RedriveDto): Promise<RedriveResponse> {
    return this.dlq.redrive(dto.notificationIds);
  }
}
