import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiClient } from '../clients/api-client.entity';
import { ApiKeyGuard, CurrentClient } from '../clients/api-key.guard';
import { correlationIdOf } from '../common/logging/logger.options';
import { idParamPipe } from '../common/http/id-param.pipe';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { BatchesService } from './batches.service';
import { AcceptedBatchResponse, BatchResponse } from './dto/batch.response';
import { CreateBatchDto, MAX_BATCH_RECIPIENTS } from './dto/create-batch.dto';

@ApiTags('notifications')
@ApiSecurity('api-key')
@ApiUnauthorizedResponse({ description: 'Missing or unknown X-API-Key' })
@Controller('notification-batches')
@UseGuards(ApiKeyGuard)
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Accept one notification per recipient as a batch',
    description: `Up to ${MAX_BATCH_RECIPIENTS} recipients. All or nothing: if any recipient is unusable, nothing is accepted and the errors name each one by index. The notifications are put on the queue after the response; follow progress with GET.`,
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiAcceptedResponse({
    type: AcceptedBatchResponse,
    headers: {
      Location: { description: 'URL of the batch.' },
      'Idempotent-Replayed': {
        description: '"true" when this is a stored response.',
      },
    },
  })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  @ApiProblemResponse(ProblemTypes.IDEMPOTENCY_KEY_IN_PROGRESS)
  @ApiProblemResponse(ProblemTypes.TEMPLATE_UNUSABLE)
  @ApiProblemResponse(ProblemTypes.RECIPIENT_UNUSABLE)
  async create(
    @CurrentClient() client: ApiClient,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateBatchDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedBatchResponse> {
    const result = await this.batches.accept(
      client,
      idempotencyKey,
      dto,
      correlationIdOf(req),
    );
    res.status(result.status);
    res.location(`/notification-batches/${result.body.batchId}`);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a batch and its notification counts by status',
  })
  @ApiOkResponse({ type: BatchResponse })
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  get(
    @CurrentClient() client: ApiClient,
    @Param('id', idParamPipe()) id: number,
  ): Promise<BatchResponse> {
    return this.batches.get(client, id);
  }
}
