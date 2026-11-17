import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [PrismaModule, FinanceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
