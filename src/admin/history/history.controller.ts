import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import {
  NotificationHistoryPage,
  SearchNotificationsQuery,
} from './history.dto';
import { HistoryService } from './history.service';

@ApiTags('admin: notifications')
@ApiSecurity('admin-key')
@ApiUnauthorizedResponse({ description: 'Missing or wrong X-Admin-Key' })
@Controller('admin/notifications')
@UseGuards(AdminKeyGuard)
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Search notifications, newest first',
    description:
      'Within a period of at most 92 days (default: the last 7). Filters combine with AND.',
  })
  @ApiOkResponse({ type: NotificationHistoryPage })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  search(
    @Query() query: SearchNotificationsQuery,
  ): Promise<NotificationHistoryPage> {
    return this.history.search(query);
  }
}
