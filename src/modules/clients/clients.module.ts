import { FinancePermissionService } from '../finance/finance-permission.service';
import { FinancialDataGuard } from '../../common/guards/financial-data.guard';
import { ClientImportController } from './import/client-import.controller';
import { ClientImportService } from './import/client-import.service';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

@Module({
  imports: [PrismaModule, ActivityLogModule],
  controllers: [ClientsController, ClientImportController],
  providers: [FinancialDataGuard, FinancePermissionService,ClientsService, ClientImportService],
})
export class ClientsModule {}
