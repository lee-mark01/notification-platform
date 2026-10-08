import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import type { Response } from 'express';
import { ApiClient } from '../clients/api-client.entity';
import { ApiKeyGuard, CurrentClient } from '../clients/api-key.guard';
import { idParamPipe } from '../common/http/id-param.pipe';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { CreateNotificationDto } from './dto/create-notification.dto';
import {
  AcceptedNotificationResponse,
  NotificationResponse,
} from './dto/notification.response';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiSecurity('api-key')
@ApiUnauthorizedResponse({ description: 'Missing or unknown X-API-Key' })
@Controller('notifications')
@UseGuards(ApiKeyGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Accept a notification for asynchronous delivery',
    description:
      'Repeat a request with the same Idempotency-Key to get the original response (Idempotent-Replayed: true).',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiAcceptedResponse({
    type: AcceptedNotificationResponse,
    headers: {
      Location: { description: 'URL of the notification.' },
      'Idempotent-Replayed': {
        description: '"true" when this is a stored response.',
      },
    },
  })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  @ApiProblemResponse(ProblemTypes.IDEMPOTENCY_KEY_IN_PROGRESS)
  @ApiProblemResponse(ProblemTypes.TEMPLATE_UNUSABLE)
  async create(
    @CurrentClient() client: ApiClient,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateNotificationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedNotificationResponse> {
    const result = await this.notifications.accept(client, idempotencyKey, dto);
    res.status(result.status);
    res.location(`/notifications/${result.body.id}`);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification and its delivery attempts' })
  @ApiOkResponse({ type: NotificationResponse })
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  get(
    @CurrentClient() client: ApiClient,
    @Param('id', idParamPipe()) id: number,
  ): Promise<NotificationResponse> {
    return this.notifications.get(client, id);
  }
}
