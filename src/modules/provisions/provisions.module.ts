import { FinancePermissionService } from '../finance/finance-permission.service';
import { FinancialDataGuard } from '../../common/guards/financial-data.guard';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ProvisionsService } from './provisions.service';
import { ProvisionsController } from './provisions.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ProvisionsController],
  providers: [FinancialDataGuard, FinancePermissionService,ProvisionsService],
})
export class ProvisionsModule {}
