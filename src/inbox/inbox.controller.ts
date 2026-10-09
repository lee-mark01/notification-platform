import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, UserJwtGuard } from '../auth/user-jwt.guard';
import { idParamPipe } from '../common/http/id-param.pipe';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { AppUser } from '../users/app-user.entity';
import {
  InboxPage,
  ListInboxQuery,
  ReadAllResult,
  ReadState,
  UnreadCount,
} from './dto/inbox.dto';
import { InboxService } from './inbox.service';

@ApiTags('me')
@ApiBearerAuth('user-jwt')
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
@Controller('me/notifications')
@UseGuards(UserJwtGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications, newest first' })
  @ApiOkResponse({ type: InboxPage })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  list(
    @CurrentUser() user: AppUser,
    @Query() query: ListInboxQuery,
  ): Promise<InboxPage> {
    return this.inbox.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count my unread notifications' })
  @ApiOkResponse({ type: UnreadCount })
  unreadCount(@CurrentUser() user: AppUser): Promise<UnreadCount> {
    return this.inbox.unreadCount(user);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my notifications read' })
  @ApiOkResponse({ type: ReadAllResult })
  readAll(@CurrentUser() user: AppUser): Promise<ReadAllResult> {
    return this.inbox.markAllRead(user);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark read; repeating keeps the first read time',
  })
  @ApiOkResponse({ type: ReadState })
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  read(
    @CurrentUser() user: AppUser,
    @Param('id', idParamPipe()) id: number,
  ): Promise<ReadState> {
    return this.inbox.markRead(user, id);
  }

  @Patch(':id/unread')
  @ApiOperation({ summary: 'Mark unread' })
  @ApiOkResponse({ type: ReadState })
  @ApiProblemResponse(ProblemTypes.RESOURCE_NOT_FOUND)
  unread(
    @CurrentUser() user: AppUser,
    @Param('id', idParamPipe()) id: number,
  ): Promise<ReadState> {
    return this.inbox.markUnread(user, id);
  }
}
