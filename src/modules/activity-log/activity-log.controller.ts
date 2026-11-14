import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ActivityLogService } from './activity-log.service';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ActivityLogQueryDto } from './dto/dossier-history-query.dto';

@ApiTags('activity-log')
@ApiBearerAuth()
@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  findAll(@CurrentUser() user: CurrentUserPayload, @Query() query: ActivityLogQueryDto) {
    return this.activityLogService.findAll(user.id, query);
  }
}
