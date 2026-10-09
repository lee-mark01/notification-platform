import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  // SNS retries until it receives a 2xx, so a duplicate is also 200.
  @Post('ses')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive SES events from SNS (signature verified)',
  })
  @ApiConsumes('text/plain')
  @ApiBody({ description: 'SNS message JSON, sent as text/plain' })
  @ApiOkResponse({
    description: 'Stored, duplicate, or subscription confirmed',
  })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  @ApiProblemResponse(ProblemTypes.WEBHOOK_REJECTED)
  async receive(@Body() body: unknown): Promise<{ result: string }> {
    const { outcome } = await this.webhooks.receive(body);
    return { result: outcome };
  }
}
