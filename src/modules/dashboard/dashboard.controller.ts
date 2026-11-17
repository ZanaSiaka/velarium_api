import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
  ) { }

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  getSummary(
    @CurrentUser() user: CurrentUserPayload,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getSummary(
      user.role,
      startDate,
      endDate,
    );
  }
}
