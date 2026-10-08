import {
  Body,
  Controller,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, UserJwtGuard } from '../auth/user-jwt.guard';
import { ApiProblemResponse } from '../common/problem/problem-details.dto';
import { ProblemTypes } from '../common/problem/problem-types';
import { AppUser } from '../users/app-user.entity';
import { DevicesService } from './devices.service';
import { DeviceResponse } from './dto/device.response';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@ApiBearerAuth('user-jwt')
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
@Controller('devices')
@UseGuards(UserJwtGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @ApiOperation({
    summary: 'Register an FCM token for the signed-in user (upsert)',
  })
  @ApiCreatedResponse({ type: DeviceResponse, description: 'New token' })
  @ApiOkResponse({
    type: DeviceResponse,
    description: 'Known token: owner and last seen time updated, reactivated',
  })
  @ApiProblemResponse(ProblemTypes.VALIDATION_FAILED)
  async register(
    @CurrentUser() user: AppUser,
    @Body() dto: RegisterDeviceDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeviceResponse> {
    const { created, device } = await this.devices.register(user, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return DeviceResponse.from(device);
  }
}
